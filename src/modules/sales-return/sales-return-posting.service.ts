import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { SalesReturnStatus } from './enums/sales-return.enum';
import { ReverseSalesReturnDto } from './dto/reverse-sales-return.dto';
import { SalesLineType, SalesPaymentType } from '../sales-invoice/enums/sales-invoice.enum';
import { round2 } from '../sales-invoice/sales-math';
import { Product } from '../product/entities/product.entity';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import { CustomerLedgerService } from '../customer/customer-ledger.service';
import { CustomerTransactionType } from '../customer/enums/customer-transaction.enum';
import { CashSubledgerService } from '../cash-subledger/cash-subledger.service';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

/**
 * Accounting/inventory side-effects of a sales return — the inverse of a sale
 * for the returned quantities. On posting (ONE txn): stock lines are received
 * back at their original cost, one journal reduces revenue/VAT, reverses COGS
 * and restores inventory, and the customer's receivable is credited (or a cash
 * refund is paid). All journal rows go through the central JournalEntryService.
 */
@Injectable()
export class SalesReturnPostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashSubledger: CashSubledgerService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
  ) {}

  async post(id: string, actorId?: string, branchScope: string | null = null): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (branchScope && ret.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على مردود المبيعات');
      }
      if (ret.status !== SalesReturnStatus.DRAFT) throw new BadRequestException('لا يمكن ترحيل مردود غير مسودة');
      if (!ret.items?.length) throw new BadRequestException('لا يمكن ترحيل مردود بدون أصناف');

      const { fiscalYear } = await this.assertOpenPostingContext(
        ret.fiscalYearId, ret.accountingPeriodId, ret.returnDate, manager,
      );
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      const products = await this.loadProducts(ret.items.map((i) => i.productId), manager);
      this.validateAccounts(ret, products, settings);

      const number = await this.sequenceService.nextDocumentNumber('SR', fiscalYear, manager);

      // Receive returned STOCK lines back at their original cost.
      const stockLines: StockLineInput[] = ret.items
        .filter((i) => i.lineType !== SalesLineType.MANUFACTURING && products.get(i.productId)?.trackInventory)
        .map((i) => ({ warehouseId: ret.warehouseId, productId: i.productId, quantity: i.quantity, unitCost: i.costAtPost }));
      if (stockLines.length) {
        await this.stockService.receive(stockLines, manager, {
          movementType: StockMovementType.SALE_RETURN,
          sourceType: JournalSourceType.SALES_RETURN,
          sourceId: ret.id,
          sourceNumber: number,
          movementDate: ret.returnDate,
          actorId,
        });
      }

      const lines = this.buildJournalLines(ret, products, settings);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.SALES_RETURN,
          sourceId: ret.id,
          sourceNumber: number,
          entryDate: ret.returnDate,
          fiscalYearId: ret.fiscalYearId,
          accountingPeriodId: ret.accountingPeriodId,
          branchId: ret.branchId,
          description: `مردود مبيعات ${number} — فاتورة ${ret.invoiceNumber ?? ''}`,
          lines,
          actorId,
        },
        manager,
      );

      // Credit sale → reduce the customer's receivable.
      if (ret.paymentType === SalesPaymentType.CREDIT) {
        await this.customerLedger.record(
          {
            customerId: ret.customerId,
            transactionDate: ret.returnDate,
            type: CustomerTransactionType.SALES_RETURN,
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: number,
            debit: 0,
            credit: ret.totalAmount,
            description: `مردود مبيعات ${number}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash return: refund leaves the treasury/bank (no extra journal — the
        // entry above already credited the cash account).
        await this.cashSubledger.record(
          {
            cashAccountId: ret.cashAccountId,
            documentKind: 'sale_return',
            amount: ret.totalAmount,
            transactionDate: ret.returnDate,
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: number,
            journalEntryId: journalEntry.id,
            description: `مردود مبيعات نقدي ${number}`,
            actorId,
          },
          manager,
        );
      }

      ret.returnNumber = number;
      ret.status = SalesReturnStatus.POSTED;
      ret.journalEntryId = journalEntry.id;
      ret.postedAt = new Date();
      ret.postedBy = actorId ?? null;
      ret.updatedBy = actorId ?? null;

      await manager.getRepository(SalesReturn).save(ret);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReverseSalesReturnDto, actorId?: string, branchScope: string | null = null): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (branchScope && ret.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على مردود المبيعات');
      }
      if (ret.status === SalesReturnStatus.REVERSED) throw new ConflictException('المردود معكوس بالفعل');
      if (ret.status !== SalesReturnStatus.POSTED) throw new BadRequestException('لا يمكن عكس مردود غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = ret.journalEntryId ? await this.journalService.findWithLines(ret.journalEntryId) : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للمردود');

      const products = await this.loadProducts(ret.items.map((i) => i.productId), manager);
      // Reversing the return re-issues the stock back out.
      const stockLines: StockLineInput[] = ret.items
        .filter((i) => i.lineType !== SalesLineType.MANUFACTURING && products.get(i.productId)?.trackInventory)
        .map((i) => ({ warehouseId: ret.warehouseId, productId: i.productId, quantity: i.quantity }));
      if (stockLines.length) {
        await this.stockService.issue(stockLines, manager, {
          movementType: StockMovementType.SALE_RETURN,
          sourceType: JournalSourceType.SALES_RETURN,
          sourceId: ret.id,
          sourceNumber: ret.returnNumber,
          movementDate: dto.reversalDate,
          actorId,
          allowNegative: true,
        });
      }

      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس مردود مبيعات',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.SALES_RETURN,
          sourceId: ret.id,
          sourceNumber: ret.returnNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: ret.branchId,
          description: `عكس مردود مبيعات ${ret.returnNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      if (ret.paymentType === SalesPaymentType.CREDIT) {
        await this.customerLedger.record(
          {
            customerId: ret.customerId,
            transactionDate: dto.reversalDate,
            type: CustomerTransactionType.REVERSAL,
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            debit: ret.totalAmount,
            credit: 0,
            description: `عكس مردود مبيعات ${ret.returnNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash return reversal: the refunded cash comes back INTO the treasury/bank.
        await this.cashSubledger.record(
          {
            cashAccountId: ret.cashAccountId,
            documentKind: 'sale_return',
            amount: ret.totalAmount,
            reversal: true,
            transactionDate: dto.reversalDate,
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            journalEntryId: reversalEntry.id,
            description: `عكس مردود مبيعات نقدي ${ret.returnNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      }

      ret.status = SalesReturnStatus.REVERSED;
      ret.reversedAt = new Date();
      ret.reversedBy = actorId ?? null;
      ret.reversalReason = dto.reason;
      ret.reversalJournalEntryId = reversalEntry.id;
      ret.updatedBy = actorId ?? null;

      await manager.getRepository(SalesReturn).save(ret);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING (inverse of the sale)
  // =========================================================
  private buildJournalLines(
    ret: SalesReturn,
    products: Map<string, Product>,
    settings: AccountingSetting,
  ): JournalLineInput[] {
    const acc = new Map<string, { debit: number; credit: number }>();
    const add = (accountId: string, debit: number, credit: number): void => {
      const e = acc.get(accountId) ?? { debit: 0, credit: 0 };
      e.debit = round2(e.debit + debit);
      e.credit = round2(e.credit + credit);
      acc.set(accountId, e);
    };

    // Credit receivable (credit sale) or refund cash/bank (cash sale).
    const creditAccount =
      ret.paymentType === SalesPaymentType.CREDIT ? settings.customerControlAccountId! : ret.cashAccountId!;
    add(creditAccount, 0, ret.totalAmount);

    // Debit revenue (reduce it) + debit output VAT.
    for (const item of ret.items) {
      const revenueAccount = products.get(item.productId)!.salesAccountId ?? settings.salesRevenueAccountId!;
      add(revenueAccount, item.netBeforeTax, 0);
    }
    if (ret.vatAmount > 0) add(settings.outputVatAccountId!, ret.vatAmount, 0);

    // Restore inventory + reverse COGS for returned stock lines.
    for (const item of ret.items) {
      if (item.lineType === SalesLineType.MANUFACTURING) continue;
      const product = products.get(item.productId)!;
      if (!product.trackInventory) continue;
      const cost = round2(item.quantity * item.costAtPost);
      if (cost <= 0) continue;
      const cogs = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      const inventory = this.resolveInventoryAccount(product, settings)!;
      add(inventory, cost, 0);
      add(cogs, 0, cost);
    }

    return [...acc.entries()]
      .map(([accountId, e]) => {
        const net = round2(e.debit - e.credit);
        return net >= 0 ? { accountId, debit: net, credit: 0 } : { accountId, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
  }

  private validateAccounts(ret: SalesReturn, products: Map<string, Product>, settings: AccountingSetting): void {
    const block = (msg: string): never => {
      throw new BadRequestException(`لا يمكن ترحيل مردود المبيعات لأن ${msg}`);
    };
    if (ret.paymentType === SalesPaymentType.CREDIT) {
      if (!settings.customerControlAccountId) block('حساب مراقبة العملاء غير محدد في إعدادات المحاسبة.');
    } else if (!ret.cashAccountId) {
      block('حساب النقدية/البنك غير محدد لاسترداد البيع النقدي.');
    }
    for (const item of ret.items) {
      const product = products.get(item.productId);
      if (!product) block('أحد المنتجات غير موجود.');
      const revenue = product!.salesAccountId ?? settings.salesRevenueAccountId;
      if (!revenue) block('حساب إيرادات المبيعات غير محدد في إعدادات المحاسبة.');
      if (item.lineType !== SalesLineType.MANUFACTURING && product!.trackInventory) {
        if (!(product!.cogsAccountId ?? settings.costOfGoodsSoldAccountId)) {
          block('حساب تكلفة البضاعة المباعة غير محدد في إعدادات المحاسبة.');
        }
        if (!this.resolveInventoryAccount(product!, settings)) {
          block(`حساب المخزون للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
        }
      }
    }
    if (ret.vatAmount > 0 && !settings.outputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المبيعات غير محدد في إعدادات المحاسبة.');
    }
  }

  private resolveInventoryAccount(product: Product, settings: AccountingSetting): string | null {
    if (product.inventoryAccountId) return product.inventoryAccountId;
    return product.productType === ProductType.RAW_MATERIAL
      ? settings.rawMaterialInventoryAccountId
      : settings.finishedGoodsInventoryAccountId;
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async lock(manager: EntityManager, id: string): Promise<SalesReturn> {
    const r = await manager.findOne(SalesReturn, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!r) throw new NotFoundException('لم يتم العثور على مردود المبيعات');
    return r;
  }

  private reload(manager: EntityManager, id: string): Promise<SalesReturn> {
    return manager.findOne(SalesReturn, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<SalesReturn>;
  }

  private async loadProducts(ids: string[], manager: EntityManager): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    const rows = unique.length ? await manager.getRepository(Product).find({ where: { id: In(unique) } }) : [];
    return new Map(rows.map((p): [string, Product] => [p.id, p]));
  }

  private async assertOpenPostingContext(
    fiscalYearId: string,
    accountingPeriodId: string,
    entryDate: string,
    manager: EntityManager,
  ): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id: accountingPeriodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYear.id) throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    if (period.isClosed) throw new BadRequestException('لا يمكن الترحيل إلى فترة محاسبية مغلقة');
    this.assertDateWithin(entryDate, period.startDate, period.endDate, 'تاريخ المردود خارج نطاق الفترة المحاسبية');
    return { fiscalYear, period };
  }

  private async getOpenPeriod(id: string, manager: EntityManager): Promise<AccountingPeriod> {
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id } });
    if (!period) throw new NotFoundException('الفترة المحاسبية للعكس غير موجودة');
    if (period.isClosed) throw new BadRequestException('الفترة المحاسبية للعكس مغلقة، يرجى اختيار فترة مفتوحة');
    return period;
  }

  private assertDateWithin(date: string, start: string, end: string, message: string): void {
    const d = new Date(date).getTime();
    if (d < new Date(start).getTime() || d > new Date(end).getTime()) throw new BadRequestException(message);
  }
}
