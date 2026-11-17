import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { isWithinBranchScope } from "../../common/utils/branch-scope.util";
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnStatus } from './enums/purchase-return.enum';
import { ReversePurchaseReturnDto } from './dto/reverse-purchase-return.dto';
import { PurchasePaymentType } from '../purchase-invoice/enums/purchase-invoice.enum';
import { Product } from '../product/entities/product.entity';
import { applyEffectiveAccounts } from '../product/product-accounts';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockDirection, StockMovementType } from '../stock/enums/stock.enum';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { SequenceService } from '../sequence/sequence.service';
import { SupplierLedgerService } from '../supplier/supplier-ledger.service';
import { SupplierTransactionType } from '../supplier/enums/supplier-transaction.enum';
import { CashSubledgerService } from '../cash-subledger/cash-subledger.service';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { JournalLineBuilder } from '../journal-entry/journal-line-builder';
import { Supplier } from '../supplier/entities/supplier.entity';
import { missingAccountMessage } from '../product/product-accounts';

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v: number): number { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

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

  async post(id: string, actorId?: string, branchScope: string[] | null = null): Promise<PurchaseReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (!isWithinBranchScope(ret.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على مردود المشتريات');
      }
      if (ret.status !== PurchaseReturnStatus.DRAFT) throw new BadRequestException('لا يمكن ترحيل مردود غير مسودة');
      if (!ret.items?.length) throw new BadRequestException('لا يمكن ترحيل مردود بدون أصناف');

      const { fiscalYear } = await this.assertOpenPostingContext(ret.fiscalYearId, ret.accountingPeriodId, ret.returnDate, manager);
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      const products = await this.loadProducts(ret.items.map((i) => i.productId), manager);
      this.validateAccounts(ret, products, settings);

      const number = await this.sequenceService.nextDocumentNumber('PR', fiscalYear, manager);

      // Goods that are no longer in the warehouse can not be sent back to the supplier.
      await this.assertOnHand(ret, manager);

      // Issue the returned goods at the cost they were PURCHASED at (not the warehouse
      // average): the stock value then drops by exactly what the journal credits to
      // inventory, and the average of what is left is recomputed.
      ret.items.forEach((i) => (i.unitCostAtPost = this.purchaseUnitCost(i)));
      const stockLines: StockLineInput[] = ret.items.map((i) => ({
        warehouseId: ret.warehouseId,
        productId: i.productId,
        productName: i.productName ?? undefined,
        quantity: i.quantity,
        exactUnitCost: i.unitCostAtPost,
      }));
      await this.stockService.issue(stockLines, manager, {
        movementType: StockMovementType.PURCHASE_RETURN,
        sourceType: JournalSourceType.PURCHASE_RETURN,
        sourceId: ret.id,
        sourceNumber: number,
        movementDate: ret.returnDate,
        actorId,
        // On-hand already checked above (strictly, whatever the warehouse setting).
        allowNegative: true,
      });

      const supplier = await manager.getRepository(Supplier).findOne({ where: { id: ret.supplierId }, select: { id: true, name: true } });
      const supplierName = supplier?.name ?? '';
      const lines = this.buildJournalLines(ret, products, settings, number, supplierName);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_RETURN,
          sourceId: ret.id,
          sourceNumber: number,
          entryDate: ret.returnDate,
          fiscalYearId: ret.fiscalYearId,
          accountingPeriodId: ret.accountingPeriodId,
          branchId: ret.branchId,
          description: `مردود مشتريات ${number} — فاتورة ${ret.invoiceNumber ?? ''} — المورد: ${supplierName}`,
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

  async reverse(id: string, dto: ReversePurchaseReturnDto, actorId?: string, branchScope: string[] | null = null): Promise<PurchaseReturn> {
    return this.dataSource.transaction(async (manager) => {
      const ret = await this.lock(manager, id);
      if (!isWithinBranchScope(ret.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على مردود المشتريات');
      }
      if (ret.status === PurchaseReturnStatus.REVERSED) throw new ConflictException('المردود معكوس بالفعل');
      if (ret.status !== PurchaseReturnStatus.POSTED) throw new BadRequestException('لا يمكن عكس مردود غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate, 'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = ret.journalEntryId ? await this.journalService.findWithLines(ret.journalEntryId) : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للمردود');

      // Reversing the return receives the goods back at the cost they actually LEFT at
      // (its own stock movements), so the warehouse is exactly as before the return —
      // also for returns posted before they went out at the purchase cost.
      const leftAt = await this.issuedUnitCosts(ret.id, manager);
      await this.stockService.receive(
        ret.items.map((i) => ({
          warehouseId: ret.warehouseId,
          productId: i.productId,
          quantity: i.quantity,
          unitCost: leftAt.get(i.productId) ?? this.purchaseUnitCost(i),
        })),
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
  private buildJournalLines(ret: PurchaseReturn, products: Map<string, Product>, settings: AccountingSetting, number: string, supplierName: string): JournalLineInput[] {
    const b = new JournalLineBuilder();
    const ref = `مردود مشتريات ${number}`;

    // Debit the payable (credit purchase, tagged with the supplier) or cash/bank refund (cash purchase).
    if (ret.paymentType === PurchasePaymentType.CREDIT) {
      b.add(settings.supplierControlAccountId!, ret.totalAmount, 0, `تخفيض مستحق المورد ${supplierName} — ${ref}`, { supplierId: ret.supplierId });
    } else {
      b.add(ret.cashAccountId!, ret.totalAmount, 0, `استرداد نقدي من المورد ${supplierName} — ${ref}`);
    }

    // Credit inventory (goods leave) at the returned net cost.
    for (const item of ret.items) {
      b.add(this.resolveInventoryAccount(products.get(item.productId)!, settings)!, 0, item.netBeforeTax, `إخراج بضاعة مرتجعة من المخزن — ${ref}`, { warehouseId: ret.warehouseId });
    }
    // Credit recoverable input VAT (reduce it).
    if (ret.vatAmount > 0) b.add(settings.inputVatAccountId!, 0, ret.vatAmount, `عكس ضريبة القيمة المضافة (مدخلات) — ${ref}`);

    return b.build();
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
        block(missingAccountMessage('inventory', product!.name));
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
  /** Net unit cost the line was bought at: the purchase line's snapshot, else (older
   *  invoices posted before the snapshot existed) the line's net ÷ quantity. */
  private purchaseUnitCost(item: PurchaseReturnItem): number {
    if (Number(item.unitCostAtPost) > 0) return Number(item.unitCostAtPost);
    const qty = Number(item.quantity) || 0;
    return qty > 0 ? round2((Number(item.netBeforeTax) || 0) / qty) : 0;
  }

  /** Refuse the return when the warehouse no longer holds the quantity being sent back. */
  private async assertOnHand(ret: PurchaseReturn, manager: EntityManager): Promise<void> {
    const wanted = new Map<string, { qty: number; name: string }>();
    for (const i of ret.items) {
      const w = wanted.get(i.productId) ?? { qty: 0, name: i.productName ?? '' };
      w.qty = round3(w.qty + (Number(i.quantity) || 0));
      wanted.set(i.productId, w);
    }
    const stock = await manager.getRepository(WarehouseStock).find({
      where: { warehouseId: ret.warehouseId, productId: In([...wanted.keys()]) },
      lock: { mode: 'pessimistic_write' },
    });
    const onHand = new Map(stock.map((s): [string, number] => [s.productId, Number(s.quantity) || 0]));
    const short = [...wanted.entries()].filter(([id, w]) => (onHand.get(id) ?? 0) + 1e-6 < w.qty);
    if (!short.length) return;
    const wh = await manager.getRepository(Warehouse).findOne({ where: { id: ret.warehouseId }, select: { id: true, name: true } });
    const lines = short.map(([id, w]) => `«${w.name}»: الموجود ${round3(Math.max(0, onHand.get(id) ?? 0))} والمطلوب إرجاعه ${w.qty}`);
    throw new BadRequestException(
      `لا يمكن ترحيل المرتجع لأن الكمية غير موجودة في المخزن «${wh?.name ?? ''}» — ${lines.join(' · ')}`,
    );
  }

  /** Unit cost each product left the warehouse at when this return was posted. */
  private async issuedUnitCosts(returnId: string, manager: EntityManager): Promise<Map<string, number>> {
    const rows = await manager.getRepository(StockMovement).find({
      where: { sourceId: returnId, sourceType: JournalSourceType.PURCHASE_RETURN, direction: StockDirection.OUT },
    });
    const sums = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const s = sums.get(r.productId) ?? { qty: 0, value: 0 };
      s.qty += Number(r.quantity) || 0;
      s.value += (Number(r.quantity) || 0) * (Number(r.unitCost) || 0);
      sums.set(r.productId, s);
    }
    return new Map([...sums.entries()].filter(([, s]) => s.qty > 0).map(([id, s]): [string, number] => [id, round2(s.value / s.qty)]));
  }

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
