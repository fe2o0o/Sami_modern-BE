import { JournalEntry } from '../journal-entry/entities/journal-entry.entity';
import { JournalEntryStatus } from '../journal-entry/enums/journal-entry.enum';
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
import { ReturnManufacturingAction, SalesReturnStatus } from './enums/sales-return.enum';
import { SalesReturnCommission } from './entities/sales-return-commission.entity';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { ReverseSalesReturnDto } from './dto/reverse-sales-return.dto';
import { SalesCommissionType, SalesDeliveryStatus as InvoiceDeliveryStatus, SalesLineType, SalesPaymentType } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { ManufacturingOrderStatus } from '../manufacturing/enums/manufacturing.enum';
import { ManufacturingProductionService } from '../manufacturing/manufacturing-production.service';
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
import { SalesDeliveryProgress, SalesDeliveryStatus } from '../sales-delivery/enums/sales-delivery.enum';
import { fulfilmentState } from '../sales-delivery/delivery-progress.util';
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
    private readonly production: ManufacturingProductionService,
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

      // How much of each line goes back INTO stock (manufacturing: delivered part only).
      await this.assignRestockQuantities(ret, products, manager);

      // Receive returned goods back at their original (delivery) cost.
      const stockLines: StockLineInput[] = ret.items
        .filter((i) => Number(i.restockedQuantity) > 0)
        .map((i) => ({ warehouseId: (i.warehouseId ?? ret.warehouseId)!, productId: i.productId, quantity: Number(i.restockedQuantity), unitCost: i.costAtPost }));
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
      // The credited undelivered quantity must never ship: close it on the
      // delivery order (and shrink a production order that has not started).
      ret.returnNumber = number;
      await this.syncClosedQuantities(ret, 1, ret.returnDate, actorId, manager);
      // The employees' commission on the returned products is taken back too.
      await this.takeBackCommissions(ret, settings, number, lines, manager);
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
      // Reversing the return re-issues exactly what it put back into stock. (Returns
      // posted before restockedQuantity existed fall back to the old rule.)
      const stockLines: StockLineInput[] = ret.items
        .map((i) => ({ i, qty: Number(i.restockedQuantity) > 0 ? Number(i.restockedQuantity) : this.touchesStock(i, products) ? i.quantity : 0 }))
        .filter(({ qty }) => qty > 0)
        .map(({ i, qty }) => ({ warehouseId: (i.warehouseId ?? ret.warehouseId)!, productId: i.productId, quantity: qty }));
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

      // Correction entries posted later for this return (e.g. the one-off fix that
      // restocked delivered manufactured items) are reversed with it too.
      const extras = await manager.getRepository(JournalEntry).find({
        where: { sourceType: JournalSourceType.SALES_RETURN, sourceId: ret.id, status: JournalEntryStatus.POSTED },
      });
      for (const extra of extras.filter((e) => e.id !== ret.journalEntryId && !e.reversalOfJournalEntryId)) {
        const full = await this.journalService.findWithLines(extra.id);
        if (!full) continue;
        const rev = await this.journalService.createSystemJournalEntry(
          {
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            entryDate: dto.reversalDate,
            fiscalYearId: period.fiscalYearId,
            accountingPeriodId: period.id,
            branchId: ret.branchId,
            description: `عكس ${full.description ?? 'قيد تصحيح مردود'} — ${dto.reason}`,
            reversalOfJournalEntryId: full.id,
            lines: full.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.credit,
              credit: l.debit,
              description: l.description ? `عكس: ${l.description}` : 'عكس قيد تصحيح مردود',
              productId: l.productId,
              warehouseId: l.warehouseId,
            })),
            actorId,
          },
          manager,
        );
        await this.journalService.markEntryReversed(full.id, rev.id, dto.reason, actorId, manager);
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

      // The quantity this return closed on the delivery order is owed again (the
      // customer was just re-charged by this reversal).
      await this.syncClosedQuantities(ret, -1, dto.reversalDate, actorId, manager);

      // Returns posted before `closedQuantity` existed: the «إلغاء الصنف» path
      // closed the line itself — un-cancel it the old way.
      const cancelled = await manager.getRepository(SalesDeliveryItem).find({ where: { cancelReturnId: ret.id } });
      for (const line of cancelled) {
        const back = (ret.items ?? [])
          .filter((i) => i.salesInvoiceItemId === line.salesInvoiceItemId && !(Number(i.closedQuantity) > 0))
          .reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        line.cancelledQuantity = Math.max(0, Math.round(((Number(line.cancelledQuantity) || 0) - back) * 1000) / 1000);
        line.cancelReturnId = null;
        await manager.getRepository(SalesDeliveryItem).save(line);
        const order = await manager.getRepository(SalesDelivery).findOne({ where: { id: line.salesDeliveryId }, relations: { items: true } });
        if (order) {
          order.deliveryProgress = this.progressOf(order.items);
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

    // Restore inventory + reverse COGS for what goes back into stock (stock lines,
    // and the delivered part of manufacturing lines).
    for (const item of ret.items) {
      const qty = Number(item.restockedQuantity) || 0;
      if (qty <= 0) continue;
      const product = products.get(item.productId)!;
      const cost = round2(qty * item.costAtPost);
      if (cost <= 0) continue;
      const cogs = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      const inventory = this.resolveInventoryAccount(product, settings)!;
      const what = item.lineType === SalesLineType.MANUFACTURING ? `صنف مُصنّع ${item.productName ?? ''} (${qty})` : `${item.productName ?? ''} (${qty})`;
      b.add(inventory, cost, 0, `إعادة بضاعة مرتجعة للمخزون — ${what} — ${ref}`, { warehouseId: item.warehouseId ?? ret.warehouseId });
      b.add(cogs, 0, cost, `عكس تكلفة البضاعة المباعة — ${what} — ${ref}`);
    }

    return b.build();
  }

  /**
   * Take back the sales commission earned on the returned products, per invoice
   * commission line (rows in sales_return_commissions + DR commission payable /
   * CR commission expense on the return's journal):
   *  - percentage: rate × returned product net (services excluded, like the invoice base);
   *  - fixed:      kept in full while any product of the invoice is still sold;
   *                taken back whole by the return that completes the invoice's return.
   * Once the invoice's products are fully returned, what is left of each line is
   * taken back, so rounding never leaves a residue. Reversing the return mirrors
   * the journal; its rows stop counting with its status.
   */
  private async takeBackCommissions(
    ret: SalesReturn,
    settings: AccountingSetting,
    number: string,
    lines: JournalLineInput[],
    manager: EntityManager,
  ): Promise<void> {
    ret.commissionReturned = 0;
    if (!ret.salesInvoiceId) return;
    const commissions = await manager.getRepository(SalesInvoiceCommission).find({ where: { salesInvoiceId: ret.salesInvoiceId } });
    if (!commissions.some((c) => Number(c.amount) > 0)) return;

    const isProduct = (t: SalesLineType | null | undefined) => (t ?? SalesLineType.STOCK) !== SalesLineType.SERVICE;
    const invoiceItems = await manager.getRepository(SalesInvoiceItem).find({ where: { salesInvoiceId: ret.salesInvoiceId } });
    const invoiceBase = round2(invoiceItems.filter((i) => isProduct(i.lineType)).reduce((t, i) => t + (Number(i.netBeforeTax) || 0), 0));
    const returnedBase = round2(ret.items.filter((i) => isProduct(i.lineType)).reduce((t, i) => t + (Number(i.netBeforeTax) || 0), 0));
    if (invoiceBase <= 0 || returnedBase <= 0) return;

    // What earlier POSTED returns of this invoice already took back.
    const prior = await manager
      .getRepository(SalesReturnCommission)
      .createQueryBuilder('rc')
      .innerJoin(SalesReturn, 'sr', 'sr.id = rc.salesReturnId AND sr.deletedAt IS NULL')
      .select('rc.salesInvoiceCommissionId', 'id')
      .addSelect('SUM(rc.amount)', 'amount')
      .where('rc.salesInvoiceId = :inv', { inv: ret.salesInvoiceId })
      .andWhere('sr.status = :posted', { posted: SalesReturnStatus.POSTED })
      .andWhere('sr.id <> :me', { me: ret.id })
      .groupBy('rc.salesInvoiceCommissionId')
      .getRawMany<{ id: string; amount: string }>();
    const already = new Map(prior.map((r): [string, number] => [r.id, Number(r.amount) || 0]));
    const priorBaseRow = await manager
      .getRepository(SalesReturnItem)
      .createQueryBuilder('ri')
      .innerJoin(SalesReturn, 'sr', 'sr.id = ri.salesReturnId AND sr.deletedAt IS NULL')
      .select('COALESCE(SUM(ri.netBeforeTax), 0)', 'base')
      .where('sr.salesInvoiceId = :inv', { inv: ret.salesInvoiceId })
      .andWhere('sr.status = :posted', { posted: SalesReturnStatus.POSTED })
      .andWhere('sr.id <> :me', { me: ret.id })
      .andWhere('ri.lineType <> :svc', { svc: SalesLineType.SERVICE })
      .getRawOne<{ base: string }>();
    const fullyReturned = round2(Number(priorBaseRow?.base ?? 0) + returnedBase) >= invoiceBase - 0.005;

    const rows: SalesReturnCommission[] = [];
    for (const c of commissions) {
      const earned = round2(Number(c.amount) || 0);
      const left = round2(earned - (already.get(c.id) ?? 0));
      if (left <= 0) continue;
      // A fixed commission stays whole until the invoice's products are all returned.
      let share = c.commissionType === SalesCommissionType.PERCENTAGE ? round2((returnedBase * (Number(c.value) || 0)) / 100) : 0;
      if (fullyReturned) share = left;
      share = Math.min(share, left);
      if (share <= 0) continue;
      rows.push(
        manager.getRepository(SalesReturnCommission).create({
          salesReturnId: ret.id,
          salesInvoiceId: ret.salesInvoiceId,
          salesInvoiceCommissionId: c.id,
          employeeId: c.employeeId,
          employeeName: c.employeeName,
          commissionType: c.commissionType,
          value: Number(c.value) || 0,
          returnedBase,
          amount: share,
        }),
      );
    }
    const total = round2(rows.reduce((t, r) => t + r.amount, 0));
    if (total <= 0) return;
    if (!settings.commissionExpenseAccountId || !settings.commissionPayableAccountId) {
      throw new BadRequestException('حسابا مصروف العمولات والعمولات المستحقة غير محددين في إعدادات المحاسبة — لا يمكن عكس عمولة الموظفين');
    }
    await manager.getRepository(SalesReturnCommission).save(rows);
    const who = rows.map((r) => r.employeeName ?? '').filter(Boolean).join('، ');
    lines.push({ accountId: settings.commissionPayableAccountId, debit: total, credit: 0, description: `عكس عمولات مبيعات مستحقة (${who}) — مردود مبيعات ${number}` });
    lines.push({ accountId: settings.commissionExpenseAccountId, debit: 0, credit: total, description: `عكس عمولة مبيعات (${who}) — مردود مبيعات ${number}` });
    ret.commissionReturned = total;
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
      const relQty = round3(Math.min(Number(item.closedQuantity) || 0, open));
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

  /**
   * Restocked / closed quantity per line, decided BEFORE the accrual release:
   *  - stock lines of tracked products: the whole returned quantity is restocked;
   *  - manufacturing lines: the part still undelivered is CLOSED (it must never
   *    ship after being credited); only the rest — the delivered part — goes back
   *    into stock and needs a return warehouse.
   */
  private async assignRestockQuantities(ret: SalesReturn, products: Map<string, Product>, manager: EntityManager): Promise<void> {
    const invRepo = manager.getRepository(SalesInvoiceItem);
    // Several lines of one return may hit the same invoice line.
    const taken = new Map<string, number>();
    for (const item of ret.items) {
      item.closedQuantity = 0;
      if (this.touchesStock(item, products)) {
        item.restockedQuantity = Number(item.quantity) || 0;
        continue;
      }
      item.restockedQuantity = 0;
      if (item.lineType !== SalesLineType.MANUFACTURING || !item.salesInvoiceItemId) continue;
      const inv = await invRepo.findOne({ where: { id: item.salesInvoiceItemId } });
      if (!inv) continue;
      const already = taken.get(inv.id) ?? 0;
      const openUndelivered = Math.max(0, round3((await this.openUndelivered(inv, manager)) - already));
      const qty = Number(item.quantity) || 0;
      item.closedQuantity = round3(Math.min(qty, openUndelivered));
      taken.set(inv.id, round3(already + item.closedQuantity));
      if (!products.get(item.productId)?.trackInventory) continue;
      const restock = round3(Math.max(0, qty - item.closedQuantity));
      if (restock <= 0) continue;
      if (!item.warehouseId) {
        throw new BadRequestException(`اختر المخزن الذي يعود إليه الصنف المُصنّع «${item.productName ?? ''}»`);
      }
      item.restockedQuantity = restock;
    }
  }

  /**
   * Quantity of an invoice line still owed to the customer: open on its delivery
   * order lines (ordered − delivered − cancelled). An invoice without a delivery
   * order falls back to the invoice's own counters.
   */
  private async openUndelivered(inv: SalesInvoiceItem, manager: EntityManager): Promise<number> {
    const lines = await this.deliveryLinesOf(inv.id, manager);
    if (!lines.length) {
      return Math.max(0, round3((Number(inv.quantity) || 0) - (Number(inv.deliveredQuantity) || 0) - (Number(inv.cogsReleasedQty) || 0)));
    }
    return round3(lines.reduce((s, l) => s + Math.max(0, this.lineOpen(l)), 0));
  }

  /** Delivery order lines of an invoice line (reversed delivery notes excluded). */
  private deliveryLinesOf(salesInvoiceItemId: string, manager: EntityManager): Promise<SalesDeliveryItem[]> {
    return manager
      .getRepository(SalesDeliveryItem)
      .createQueryBuilder('di')
      .innerJoin(SalesDelivery, 'sd', 'sd.id = di.salesDeliveryId AND sd.deletedAt IS NULL')
      .where('di.salesInvoiceItemId = :id', { id: salesInvoiceItemId })
      .andWhere('sd.status <> :rev', { rev: SalesDeliveryStatus.REVERSED })
      .orderBy('di.createdAt', 'ASC')
      .getMany();
  }

  private lineOpen(l: SalesDeliveryItem): number {
    return round3((Number(l.orderedQuantity) || 0) - (Number(l.deliveredQuantity) || 0) - (Number(l.cancelledQuantity) || 0));
  }

  /**
   * Close (sign +1, on post) or re-open (sign −1, on reversal) each line's
   * `closedQuantity` on its delivery order lines, keep a still-NEW production
   * order in step with what is owed, then refresh the order / invoice progress.
   */
  private async syncClosedQuantities(ret: SalesReturn, sign: 1 | -1, date: string, actorId: string | undefined, manager: EntityManager): Promise<void> {
    const itemRepo = manager.getRepository(SalesDeliveryItem);
    const touched = new Set<string>();
    for (const item of ret.items ?? []) {
      let left = round3(Number(item.closedQuantity) || 0);
      if (left <= 0 || !item.salesInvoiceItemId) continue;
      const lines = await this.deliveryLinesOf(item.salesInvoiceItemId, manager);
      for (const line of sign === 1 ? lines : [...lines].reverse()) {
        if (left <= 0) break;
        const room = sign === 1 ? Math.max(0, this.lineOpen(line)) : Number(line.cancelledQuantity) || 0;
        const take = round3(Math.min(room, left));
        if (take <= 0) continue;
        line.cancelledQuantity = round3((Number(line.cancelledQuantity) || 0) + sign * take);
        await itemRepo.save(line);
        left = round3(left - take);
        touched.add(line.salesDeliveryId);
        if (line.manufacturingOrderId) await this.followOrder(line.manufacturingOrderId, item, sign, take, ret, date, actorId, manager);
      }
    }
    for (const deliveryId of touched) await this.refreshDelivery(deliveryId, actorId, manager);
    if (touched.size) await this.refreshInvoiceDeliveryStatus(ret.salesInvoiceId, manager);
  }

  /**
   * What the return does to the line's production order (the user's choice per line):
   *  - CONTINUE: nothing — the order finishes and the item stays in the warehouse.
   *  - STOP:     a NEW order shrinks proportionally (quantity, components, fee) or
   *              is cancelled when nothing is owed; an IN_PROGRESS order has its
   *              fee booked to the factory reduced (or the whole order cancelled,
   *              reversing that fee). Reversing the return grows it back while the
   *              order is still open; a cancelled order stays cancelled — the line
   *              then needs a new order (or delivery from stock) from the delivery order.
   * Produced / finished orders are never touched: the item is already in stock.
   */
  private async followOrder(
    orderId: string,
    item: SalesReturnItem,
    sign: 1 | -1,
    qty: number,
    ret: SalesReturn,
    date: string,
    actorId: string | undefined,
    manager: EntityManager,
  ): Promise<void> {
    const repo = manager.getRepository(ManufacturingOrder);
    const mo = await repo.findOne({ where: { id: orderId }, relations: { components: true } });
    if (!mo || (mo.status !== ManufacturingOrderStatus.NEW && mo.status !== ManufacturingOrderStatus.IN_PROGRESS)) return;
    if (!item.manufacturingAction) {
      if (sign === -1) return;
      throw new BadRequestException(
        `الصنف «${item.productName ?? ''}» له أمر تصنيع ${mo.orderNumber ?? ''} لم يُنتَج بعد — حدد: إيقاف التصنيع، أم استكماله واستلامه في المخزن`,
      );
    }
    if (item.manufacturingAction !== ReturnManufacturingAction.STOP) return;

    const ref = `مردود مبيعات ${ret.returnNumber ?? ''}`;
    const reason = sign === 1 ? `إيقاف تصنيع ${qty} — العميل أرجع الصنف قبل التسليم (${ref})` : `إعادة تصنيع ${qty} — عكس ${ref}`;
    const oldQty = Number(mo.quantity) || 0;
    const newQty = round3(oldQty - sign * qty);
    if (newQty <= 0) {
      if (mo.status === ManufacturingOrderStatus.IN_PROGRESS) {
        // reverses the fee booked to the factory at start
        await this.production.cancelWithin(mo.id, manager, { actorId, date, reason });
        return;
      }
      mo.status = ManufacturingOrderStatus.CANCELLED;
      mo.notes = [mo.notes, reason].filter(Boolean).join(' — ');
      mo.updatedBy = actorId ?? null;
      await repo.save(mo);
      return;
    }
    if (oldQty <= 0) return;
    const ratio = newQty / oldQty;
    const newFee = round2((Number(mo.manufacturingFee) || 0) * ratio);
    if (mo.status === ManufacturingOrderStatus.IN_PROGRESS && mo.feeJournalEntryId) {
      // books the fee difference to the factory (supplier ledger + journal)
      await this.production.adjustBookedFeeWithin(mo.id, newFee, manager, { actorId, date, reason });
    }
    const fresh = (await repo.findOne({ where: { id: orderId }, relations: { components: true } }))!;
    for (const c of fresh.components ?? []) c.quantity = round3((Number(c.quantity) || 0) * ratio);
    fresh.manufacturingFee = newFee;
    fresh.quantity = newQty;
    fresh.notes = [fresh.notes, `${reason}: الكمية ${oldQty} ← ${newQty}`].filter(Boolean).join(' — ');
    fresh.updatedBy = actorId ?? null;
    await repo.save(fresh);
  }

  /** Delivery order progress (+ its produced orders' DONE state) after closing / re-opening quantities. */
  private async refreshDelivery(deliveryId: string, actorId: string | undefined, manager: EntityManager): Promise<void> {
    const order = await manager.getRepository(SalesDelivery).findOne({ where: { id: deliveryId }, relations: { items: true } });
    if (!order) return;
    const done = (i: SalesDeliveryItem) => (Number(i.deliveredQuantity) || 0) + (Number(i.cancelledQuantity) || 0) + 1e-6 >= (Number(i.orderedQuantity) || 0);
    const goods = order.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    order.deliveryProgress = this.progressOf(order.items);
    order.updatedBy = actorId ?? null;
    await manager.getRepository(SalesDelivery).save(order);
    // A produced order whose line is now fully closed is finished (and vice versa).
    const moRepo = manager.getRepository(ManufacturingOrder);
    for (const line of goods) {
      if (line.lineType !== SalesLineType.MANUFACTURING || !line.manufacturingOrderId) continue;
      const mo = await moRepo.findOne({ where: { id: line.manufacturingOrderId } });
      if (!mo) continue;
      if (done(line) && mo.status === ManufacturingOrderStatus.PRODUCED) {
        mo.status = ManufacturingOrderStatus.DONE;
        mo.doneAt = new Date();
      } else if (!done(line) && mo.status === ManufacturingOrderStatus.DONE) {
        mo.status = ManufacturingOrderStatus.PRODUCED;
        mo.doneAt = null;
      } else continue;
      mo.updatedBy = actorId ?? null;
      await moRepo.save(mo);
    }
  }

  /** Invoice delivery status from delivered + closed quantities of its goods lines. */
  private async refreshInvoiceDeliveryStatus(invoiceId: string | null, manager: EntityManager): Promise<void> {
    if (!invoiceId) return;
    const invoice = await manager.getRepository(SalesInvoice).findOne({ where: { id: invoiceId }, relations: { items: true } });
    if (!invoice) return;
    const goods = invoice.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    const rows = goods.length
      ? await manager.getRepository(SalesDeliveryItem).find({ where: { salesInvoiceItemId: In(goods.map((i) => i.id)) }, select: { id: true, salesInvoiceItemId: true, cancelledQuantity: true } })
      : [];
    const closed = new Map<string, number>();
    for (const r of rows) if (r.salesInvoiceItemId) closed.set(r.salesInvoiceItemId, (closed.get(r.salesInvoiceItemId) ?? 0) + (Number(r.cancelledQuantity) || 0));
    const state = fulfilmentState(goods.map((i) => ({ ordered: Number(i.quantity) || 0, delivered: Number(i.deliveredQuantity) || 0, closed: closed.get(i.id) ?? 0 })));
    invoice.deliveryStatus = (state ?? InvoiceDeliveryStatus.NOT_APPLICABLE) as InvoiceDeliveryStatus;
    await manager.getRepository(SalesInvoice).save(invoice);
  }

  /** Delivery order progress of its goods lines (closed-by-return-only → «ملغى بالمرتجع»). */
  private progressOf(items: SalesDeliveryItem[]): SalesDeliveryProgress {
    const state = fulfilmentState(
      items
        .filter((i) => i.lineType !== SalesLineType.SERVICE)
        .map((i) => ({ ordered: Number(i.orderedQuantity) || 0, delivered: Number(i.deliveredQuantity) || 0, closed: Number(i.cancelledQuantity) || 0 })),
    );
    return (state ?? SalesDeliveryProgress.PENDING) as SalesDeliveryProgress;
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
      // Goods that go back into stock (stock lines, and delivered manufactured items).
      const mayRestock = this.touchesStock(item, products) || (item.lineType === SalesLineType.MANUFACTURING && !!product?.trackInventory);
      if (mayRestock) {
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
