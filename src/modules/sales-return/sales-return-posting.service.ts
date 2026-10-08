import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { isWithinBranchScope } from "../../common/utils/branch-scope.util";
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { SalesReturnStatus } from './enums/sales-return.enum';
import { ReverseSalesReturnDto } from './dto/reverse-sales-return.dto';
import { SalesLineType, SalesPaymentType } from '../sales-invoice/enums/sales-invoice.enum';
import { round2 } from '../sales-invoice/sales-math';
import { Product } from '../product/entities/product.entity';
import { applyEffectiveAccounts } from '../product/product-accounts';
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
import { JournalLineBuilder } from '../journal-entry/journal-line-builder';
import { Customer } from '../customer/entities/customer.entity';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { SalesDeliveryProgress } from '../sales-delivery/enums/sales-delivery.enum';
import { SalesDelivery } from '../sales-delivery/entities/sales-delivery.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { missingAccountMessage } from '../product/product-accounts';

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

  async post(id: string, actorId?: string, branchScope: string[] | null = null): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (!isWithinBranchScope(ret.branchId, branchScope)) {
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
        .filter((i) => this.touchesStock(i, products))
        .map((i) => ({ warehouseId: (i.warehouseId ?? ret.warehouseId)!, productId: i.productId, quantity: i.quantity, unitCost: i.costAtPost }));
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

      const customer = await manager.getRepository(Customer).findOne({ where: { id: ret.customerId }, select: { id: true, name: true } });
      const customerName = customer?.name ?? '';
      const lines = this.buildJournalLines(ret, products, settings, number, customerName);
      // Returned quantity that was never delivered still carries the invoice's cost
      // accrual — release it (DR «بضاعة مباعة لم تُسلَّم» / CR COGS).
      await this.releaseCostAccruals(ret, products, settings, number, lines, manager);
      // A zero-value return (e.g. a free service line) has nothing to book —
      // it still closes the returned quantity but creates no journal/ledger rows.
      const journalEntry = lines.length
        ? await this.journalService.createSystemJournalEntry(
            {
              sourceType: JournalSourceType.SALES_RETURN,
              sourceId: ret.id,
              sourceNumber: number,
              entryDate: ret.returnDate,
              fiscalYearId: ret.fiscalYearId,
              accountingPeriodId: ret.accountingPeriodId,
              branchId: ret.branchId,
              description: `مردود مبيعات ${number} — فاتورة ${ret.invoiceNumber ?? ''} — العميل: ${customerName}`,
              lines,
              actorId,
            },
            manager,
          )
        : null;

      if (ret.totalAmount <= 0) {
        // nothing to settle with the customer / cashbox
      } else if (ret.paymentType === SalesPaymentType.CREDIT) {
        // Credit sale → reduce the customer's receivable.
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
            journalEntryId: journalEntry?.id ?? null,
            description: `مردود مبيعات نقدي ${number}`,
            actorId,
          },
          manager,
        );
      }

      ret.returnNumber = number;
      ret.status = SalesReturnStatus.POSTED;
      ret.journalEntryId = journalEntry?.id ?? null;
      ret.postedAt = new Date();
      ret.postedBy = actorId ?? null;
      ret.updatedBy = actorId ?? null;

      await manager.getRepository(SalesReturn).save(ret);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReverseSalesReturnDto, actorId?: string, branchScope: string[] | null = null): Promise<SalesReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (!isWithinBranchScope(ret.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على مردود المبيعات');
      }
      if (ret.status === SalesReturnStatus.REVERSED) throw new ConflictException('المردود معكوس بالفعل');
      if (ret.status !== SalesReturnStatus.POSTED) throw new BadRequestException('لا يمكن عكس مردود غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = ret.journalEntryId ? await this.journalService.findWithLines(ret.journalEntryId) : null;
      if (ret.journalEntryId && !original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للمردود');

      const products = await this.loadProducts(ret.items.map((i) => i.productId), manager);
      // Reversing the return re-issues the stock back out.
      const stockLines: StockLineInput[] = ret.items
        .filter((i) => this.touchesStock(i, products))
        .map((i) => ({ warehouseId: (i.warehouseId ?? ret.warehouseId)!, productId: i.productId, quantity: i.quantity }));
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

      // A zero-value return posted no journal — nothing to mirror back.
      let reversalEntry: { id: string } | null = null;
      if (original) {
        const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          description: l.description ? `عكس: ${l.description}` : 'عكس مردود مبيعات',
        }));
        reversalEntry = await this.journalService.createSystemJournalEntry(
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
      }

      if (ret.totalAmount <= 0) {
        // nothing was settled with the customer / cashbox
      } else if (ret.paymentType === SalesPaymentType.CREDIT) {
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
            journalEntryId: reversalEntry?.id ?? null,
            description: `عكس مردود مبيعات نقدي ${ret.returnNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      }

      // A return that CANCELLED a delivery-order line: un-cancel it so the
      // quantity is owed again (the customer was just re-charged by this reversal).
      const cancelled = await manager.getRepository(SalesDeliveryItem).find({ where: { cancelReturnId: ret.id } });
      for (const line of cancelled) {
        const back = (ret.items ?? []).filter((i) => i.salesInvoiceItemId === line.salesInvoiceItemId).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        line.cancelledQuantity = Math.max(0, Math.round(((Number(line.cancelledQuantity) || 0) - back) * 1000) / 1000);
        line.cancelReturnId = null;
        await manager.getRepository(SalesDeliveryItem).save(line);
        const order = await manager.getRepository(SalesDelivery).findOne({ where: { id: line.salesDeliveryId }, relations: { items: true } });
        if (order) {
          const goods = order.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
          const done = (i: SalesDeliveryItem) => (Number(i.deliveredQuantity) || 0) + (Number(i.cancelledQuantity) || 0) + 1e-6 >= (Number(i.orderedQuantity) || 0);
          order.deliveryProgress = goods.length && goods.every(done)
            ? SalesDeliveryProgress.DELIVERED
            : goods.some((i) => (Number(i.deliveredQuantity) || 0) > 1e-6) ? SalesDeliveryProgress.PARTIAL : SalesDeliveryProgress.PENDING;
          await manager.getRepository(SalesDelivery).save(order);
        }
      }

      // The reversal journal mirrors the release lines; put the accrual back on the invoice line.
      for (const ri of ret.items ?? []) {
        if (!(Number(ri.cogsAccrualReleased) > 0) || !ri.salesInvoiceItemId) continue;
        const invRepo = manager.getRepository(SalesInvoiceItem);
        const inv = await invRepo.findOne({ where: { id: ri.salesInvoiceItemId } });
        if (inv) {
          inv.cogsAccruedSettled = round2(Math.max(0, (Number(inv.cogsAccruedSettled) || 0) - Number(ri.cogsAccrualReleased)));
          inv.cogsReleasedQty = round3(Math.max(0, (Number(inv.cogsReleasedQty) || 0) - (Number(ri.cogsAccrualReleasedQty) || 0)));
          await invRepo.save(inv);
        }
      }

      ret.status = SalesReturnStatus.REVERSED;
      ret.reversedAt = new Date();
      ret.reversedBy = actorId ?? null;
      ret.reversalReason = dto.reason;
      ret.reversalJournalEntryId = reversalEntry?.id ?? null;
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
    number: string,
    customerName: string,
  ): JournalLineInput[] {
    const b = new JournalLineBuilder();
    const ref = `مردود مبيعات ${number}`;

    // Credit receivable (credit sale, tagged with the customer) or refund cash/bank (cash sale).
    if (ret.paymentType === SalesPaymentType.CREDIT) {
      b.add(settings.customerControlAccountId!, 0, ret.totalAmount, `تخفيض مديونية العميل ${customerName} — ${ref}`, { customerId: ret.customerId });
    } else {
      b.add(ret.cashAccountId!, 0, ret.totalAmount, `رد نقدي للعميل ${customerName} — ${ref}`);
    }

    // Debit revenue (reduce it) + debit output VAT.
    for (const item of ret.items) {
      const revenueAccount = products.get(item.productId)!.salesAccountId ?? settings.salesRevenueAccountId!;
      b.add(revenueAccount, item.netBeforeTax, 0, `عكس إيراد مبيعات — ${ref}`);
    }
    if (ret.vatAmount > 0) b.add(settings.outputVatAccountId!, ret.vatAmount, 0, `عكس ضريبة القيمة المضافة (مخرجات) — ${ref}`);

    // Restore inventory + reverse COGS for returned stock lines.
    for (const item of ret.items) {
      if (!this.touchesStock(item, products)) continue;
      const product = products.get(item.productId)!;
      const cost = round2(item.quantity * item.costAtPost);
      if (cost <= 0) continue;
      const cogs = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      const inventory = this.resolveInventoryAccount(product, settings)!;
      b.add(inventory, cost, 0, `إعادة بضاعة مرتجعة للمخزون — ${ref}`, { warehouseId: ret.warehouseId });
      b.add(cogs, 0, cost, `عكس تكلفة البضاعة المباعة — ${ref}`);
    }

    return b.build();
  }

  /**
   * For MANUFACTURING lines the return can cover quantity that was never delivered
   * (e.g. a cancelled item). That quantity still sits in the invoice's cost accrual;
   * release its share. Stock lines are only returnable once delivered, so their
   * accrual is already cleared by the delivery.
   */
  private async releaseCostAccruals(
    ret: SalesReturn,
    products: Map<string, Product>,
    settings: AccountingSetting,
    number: string,
    lines: JournalLineInput[],
    manager: EntityManager,
  ): Promise<void> {
    const invRepo = manager.getRepository(SalesInvoiceItem);
    for (const item of ret.items) {
      if (item.lineType !== SalesLineType.MANUFACTURING || !item.salesInvoiceItemId) continue;
      const inv = await invRepo.findOne({ where: { id: item.salesInvoiceItemId } });
      if (!inv) continue;
      const unsettled = round2((Number(inv.cogsAccrued) || 0) - (Number(inv.cogsAccruedSettled) || 0));
      if (unsettled <= 0) continue;
      const open = round3((Number(inv.quantity) || 0) - (Number(inv.deliveredQuantity) || 0) - (Number(inv.cogsReleasedQty) || 0));
      const relQty = round3(Math.min(Number(item.quantity) || 0, open));
      if (relQty <= 0) continue;
      const amount = relQty + 1e-6 >= open ? unsettled : round2((unsettled * relQty) / open);
      if (amount <= 0) continue;
      if (!settings.goodsSoldNotDeliveredAccountId) throw new BadRequestException('حساب «بضاعة مباعة لم تُسلَّم» غير محدد في إعدادات المحاسبة');
      const product = products.get(item.productId);
      const cogs = product?.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      lines.push({ accountId: settings.goodsSoldNotDeliveredAccountId, debit: amount, credit: 0, productId: item.productId, description: `إلغاء تكلفة مقدّرة لصنف لم يُسلَّم — مردود مبيعات ${number}` });
      lines.push({ accountId: cogs, debit: 0, credit: amount, productId: item.productId, description: `عكس تكلفة مبيعات صنف لم يُسلَّم — مردود مبيعات ${number}` });
      item.cogsAccrualReleased = amount;
      item.cogsAccrualReleasedQty = relQty;
      inv.cogsAccruedSettled = round2((Number(inv.cogsAccruedSettled) || 0) + amount);
      inv.cogsReleasedQty = round3((Number(inv.cogsReleasedQty) || 0) + relQty);
      await invRepo.save(inv);
    }
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
      if (!revenue) block(missingAccountMessage('revenue', product!.name));
      if (this.touchesStock(item, products)) {
        if (!(product!.cogsAccountId ?? settings.costOfGoodsSoldAccountId)) {
          block(missingAccountMessage('cogs', product!.name));
        }
        if (!this.resolveInventoryAccount(product!, settings)) {
          block(missingAccountMessage('inventory', product!.name));
        }
      }
    }
    if (ret.vatAmount > 0 && !settings.outputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المبيعات غير محدد في إعدادات المحاسبة.');
    }
  }

  /**
   * Only STOCK lines of inventory-tracked products move goods back into the
   * warehouse and reverse COGS. Service and manufacturing lines never touch
   * stock — even if the product record was (wrongly) flagged as tracked.
   */
  private touchesStock(item: SalesReturnItem, products: Map<string, Product>): boolean {
    return item.lineType === SalesLineType.STOCK && !!products.get(item.productId)?.trackInventory;
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
    // Category-level accounts take precedence over the product's own (legacy) ones.
    await applyEffectiveAccounts(rows, manager);
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

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
