import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnStatus } from './enums/purchase-return.enum';
import { ReversePurchaseReturnDto } from './dto/reverse-purchase-return.dto';
import { PurchasePaymentType } from '../purchase-invoice/enums/purchase-invoice.enum';
import { Product } from '../product/entities/product.entity';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import { SupplierLedgerService } from '../supplier/supplier-ledger.service';
import { SupplierTransactionType } from '../supplier/enums/supplier-transaction.enum';
import { CashSubledgerService } from '../cash-subledger/cash-subledger.service';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }

/**
 * Accounting/inventory side-effects of a purchase return — the inverse of a
 * purchase for the returned quantities. On posting (ONE txn): stock is issued
 * out, one journal reduces the payable (or records a refund), credits inventory
 * and reverses recoverable input VAT, and the supplier's payable is reduced.
 */
@Injectable()
export class PurchaseReturnPostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly cashSubledger: CashSubledgerService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
  ) {}

  async post(id: string, actorId?: string): Promise<PurchaseReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (ret.status !== PurchaseReturnStatus.DRAFT) throw new BadRequestException('لا يمكن ترحيل مردود غير مسودة');
      if (!ret.items?.length) throw new BadRequestException('لا يمكن ترحيل مردود بدون أصناف');

      const { fiscalYear } = await this.assertOpenPostingContext(ret.fiscalYearId, ret.accountingPeriodId, ret.returnDate, manager);
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      const products = await this.loadProducts(ret.items.map((i) => i.productId), manager);
      this.validateAccounts(ret, products, settings);

      const number = await this.sequenceService.nextDocumentNumber('PR', fiscalYear, manager);

      // Issue the returned goods out of the warehouse.
      const stockLines: StockLineInput[] = ret.items.map((i) => ({
        warehouseId: ret.warehouseId,
        productId: i.productId,
        productName: i.productName ?? undefined,
        quantity: i.quantity,
      }));
      await this.stockService.issue(stockLines, manager, {
        movementType: StockMovementType.PURCHASE_RETURN,
        sourceType: JournalSourceType.PURCHASE_RETURN,
        sourceId: ret.id,
        sourceNumber: number,
        movementDate: ret.returnDate,
        actorId,
        allowNegative: true,
      });

      const lines = this.buildJournalLines(ret, products, settings);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_RETURN,
          sourceId: ret.id,
          sourceNumber: number,
          entryDate: ret.returnDate,
          fiscalYearId: ret.fiscalYearId,
          accountingPeriodId: ret.accountingPeriodId,
          branchId: ret.branchId,
          description: `مردود مشتريات ${number} — فاتورة ${ret.invoiceNumber ?? ''}`,
          lines,
          actorId,
        },
        manager,
      );

      if (ret.paymentType === PurchasePaymentType.CREDIT) {
        await this.supplierLedger.record(
          {
            supplierId: ret.supplierId,
            transactionDate: ret.returnDate,
            type: SupplierTransactionType.PURCHASE_RETURN,
            sourceType: JournalSourceType.PURCHASE_RETURN,
            sourceId: ret.id,
            sourceNumber: number,
            debit: ret.totalAmount,
            credit: 0,
            description: `مردود مشتريات ${number}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash return: the supplier's refund comes INTO the treasury/bank (no extra
        // journal — the entry above already debited the cash account).
        await this.cashSubledger.record(
          {
            cashAccountId: ret.cashAccountId,
            documentKind: 'purchase_return',
            amount: ret.totalAmount,
            transactionDate: ret.returnDate,
            sourceType: JournalSourceType.PURCHASE_RETURN,
            sourceId: ret.id,
            sourceNumber: number,
            journalEntryId: journalEntry.id,
            description: `مردود مشتريات نقدي ${number}`,
            actorId,
          },
          manager,
        );
      }

      ret.returnNumber = number;
      ret.status = PurchaseReturnStatus.POSTED;
      ret.journalEntryId = journalEntry.id;
      ret.postedAt = new Date();
      ret.postedBy = actorId ?? null;
      ret.updatedBy = actorId ?? null;

      await manager.getRepository(PurchaseReturn).save(ret);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReversePurchaseReturnDto, actorId?: string): Promise<PurchaseReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (ret.status === PurchaseReturnStatus.REVERSED) throw new ConflictException('المردود معكوس بالفعل');
      if (ret.status !== PurchaseReturnStatus.POSTED) throw new BadRequestException('لا يمكن عكس مردود غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate, 'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = ret.journalEntryId ? await this.journalService.findWithLines(ret.journalEntryId) : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للمردود');

      // Reversing the return receives the goods back at their original cost.
      await this.stockService.receive(
        ret.items.map((i) => ({ warehouseId: ret.warehouseId, productId: i.productId, quantity: i.quantity, unitCost: i.unitCostAtPost })),
        manager,
        {
          movementType: StockMovementType.PURCHASE_RETURN,
          sourceType: JournalSourceType.PURCHASE_RETURN,
          sourceId: ret.id,
          sourceNumber: ret.returnNumber,
          movementDate: dto.reversalDate,
          actorId,
        },
      );

      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس مردود مشتريات',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_RETURN,
          sourceId: ret.id,
          sourceNumber: ret.returnNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: ret.branchId,
          description: `عكس مردود مشتريات ${ret.returnNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      if (ret.paymentType === PurchasePaymentType.CREDIT) {
        await this.supplierLedger.record(
          {
            supplierId: ret.supplierId,
            transactionDate: dto.reversalDate,
            type: SupplierTransactionType.REVERSAL,
            sourceType: JournalSourceType.PURCHASE_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            debit: 0,
            credit: ret.totalAmount,
            description: `عكس مردود مشتريات ${ret.returnNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash return reversal: the refunded cash leaves the treasury/bank again.
        await this.cashSubledger.record(
          {
            cashAccountId: ret.cashAccountId,
            documentKind: 'purchase_return',
            amount: ret.totalAmount,
            reversal: true,
            transactionDate: dto.reversalDate,
            sourceType: JournalSourceType.PURCHASE_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            journalEntryId: reversalEntry.id,
            description: `عكس مردود مشتريات نقدي ${ret.returnNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      }

      ret.status = PurchaseReturnStatus.REVERSED;
      ret.reversedAt = new Date();
      ret.reversedBy = actorId ?? null;
      ret.reversalReason = dto.reason;
      ret.reversalJournalEntryId = reversalEntry.id;
      ret.updatedBy = actorId ?? null;

      await manager.getRepository(PurchaseReturn).save(ret);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING (inverse of the purchase)
  // =========================================================
  private buildJournalLines(ret: PurchaseReturn, products: Map<string, Product>, settings: AccountingSetting): JournalLineInput[] {
    const acc = new Map<string, { debit: number; credit: number }>();
    const add = (accountId: string, debit: number, credit: number): void => {
      const e = acc.get(accountId) ?? { debit: 0, credit: 0 };
      e.debit = round2(e.debit + debit);
      e.credit = round2(e.credit + credit);
      acc.set(accountId, e);
    };

    // Debit the payable (credit purchase) or cash/bank refund (cash purchase).
    const debitAccount = ret.paymentType === PurchasePaymentType.CREDIT ? settings.supplierControlAccountId! : ret.cashAccountId!;
    add(debitAccount, ret.totalAmount, 0);

    // Credit inventory (goods leave) at the returned net cost.
    for (const item of ret.items) {
      add(this.resolveInventoryAccount(products.get(item.productId)!, settings)!, 0, item.netBeforeTax);
    }
    // Credit recoverable input VAT (reduce it).
    if (ret.vatAmount > 0) add(settings.inputVatAccountId!, 0, ret.vatAmount);

    return [...acc.entries()]
      .map(([accountId, e]) => {
        const net = round2(e.debit - e.credit);
        return net >= 0 ? { accountId, debit: net, credit: 0 } : { accountId, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
  }

  private validateAccounts(ret: PurchaseReturn, products: Map<string, Product>, settings: AccountingSetting): void {
    const block = (msg: string): never => {
      throw new BadRequestException(`لا يمكن ترحيل مردود المشتريات لأن ${msg}`);
    };
    if (ret.paymentType === PurchasePaymentType.CREDIT) {
      if (!settings.supplierControlAccountId) block('حساب مراقبة الموردين غير محدد في إعدادات المحاسبة.');
    } else if (!ret.cashAccountId) {
      block('حساب النقدية/البنك غير محدد لاسترداد الشراء النقدي.');
    }
    for (const item of ret.items) {
      const product = products.get(item.productId);
      if (!product) block('أحد المنتجات غير موجود.');
      if (!this.resolveInventoryAccount(product!, settings)) {
        block(`حساب المخزون للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
      }
    }
    if (ret.vatAmount > 0 && !settings.inputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المشتريات غير محدد في إعدادات المحاسبة.');
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
  private async lock(manager: EntityManager, id: string): Promise<PurchaseReturn> {
    const r = await manager.findOne(PurchaseReturn, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!r) throw new NotFoundException('لم يتم العثور على مردود المشتريات');
    return r;
  }

  private reload(manager: EntityManager, id: string): Promise<PurchaseReturn> {
    return manager.findOne(PurchaseReturn, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<PurchaseReturn>;
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
