import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { ManufacturingOrder } from './entities/manufacturing-order.entity';
import { ManufacturingOrderComponent } from './entities/manufacturing-order-component.entity';
import { ManufacturingOrderStatus } from './enums/manufacturing.enum';
import { ProduceManufacturingOrderDto } from './dto/produce-manufacturing-order.dto';
import { Product } from '../product/entities/product.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { SalesLineType } from '../sales-invoice/enums/sales-invoice.enum';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { JournalEntryService, JournalLineInput } from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { SupplierLedgerService } from '../supplier/supplier-ledger.service';
import { SupplierTransactionType } from '../supplier/enums/supplier-transaction.enum';

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v: number): number { return Math.round((v + Number.EPSILON) * 1000) / 1000; }
function todayIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Manufacturing order lifecycle with its accounting:
 *
 *  START (NEW → IN_PROGRESS) — the factory's fee is booked to the supplier
 *    right away: DR manufacturing-fee (clearing) / CR supplier control, plus a
 *    supplier subledger credit whose description names the customer and the
 *    sales invoice. Requires a supplier and a fee.
 *
 *  PRODUCE — issue the BOM components at weighted-average cost, receive the
 *    finished product at (components + fee). Journal: DR finished goods /
 *    CR raw materials / CR the fee. When the fee was booked at start, the fee
 *    credit clears the manufacturing-fee account (net zero) and NO second
 *    payable is recorded; legacy/in-house orders keep booking the fee here.
 *
 *  CANCEL — an order whose fee was booked gets a reversing entry and a
 *    supplier subledger debit before it is cancelled.
 */
@Injectable()
export class ManufacturingProductionService {
  constructor(
    private readonly stockService: StockService,
    private readonly journalService: JournalEntryService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /** Subledger/journal narration: order · product · customer · invoice. */
  private feeDescription(order: ManufacturingOrder): string {
    return `رسوم تصنيع أمر ${order.orderNumber ?? ''} — ${order.productName ?? ''} — العميل: ${order.customerName ?? '—'} — فاتورة: ${order.sourceNumber ?? '—'}`;
  }

  // =========================================================
  // START EXECUTION — books the fee to the factory (supplier)
  // =========================================================
  async start(orderId: string, actorId?: string, branchScope: string[] | null = null): Promise<ManufacturingOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(ManufacturingOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || !isWithinBranchScope(order.branchId, branchScope)) throw new NotFoundException('لم يتم العثور على أمر التصنيع');
      if (order.status !== ManufacturingOrderStatus.NEW) throw new BadRequestException('يمكن بدء التنفيذ لأمر جديد فقط');
      if (!order.factorySupplierId) throw new BadRequestException('حدد المورّد (المصنع) قبل بدء التنفيذ');
      const fee = round2(order.manufacturingFee ?? 0);
      if (fee <= 0) throw new BadRequestException('حدد رسوم التصنيع قبل بدء التنفيذ — تُرحَّل على المورّد عند البدء');

      const supplier = await manager.getRepository(Supplier).findOne({ where: { id: order.factorySupplierId } });
      if (!supplier) throw new BadRequestException('المصنع (المورّد) غير موجود');

      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      if (!settings.supplierControlAccountId) throw new BadRequestException('حساب مراقبة الموردين غير محدد في إعدادات المحاسبة');
      if (!settings.manufacturingFeeAccountId) throw new BadRequestException('حساب رسوم التصنيع غير محدد في إعدادات المحاسبة');

      const date = todayIso();
      const { fiscalYear, period } = await this.resolvePostingContext(date, manager);
      const description = this.feeDescription(order);

      // DR manufacturing-fee (clearing, cleared into finished goods at production) / CR supplier control.
      const journal = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          entryDate: date,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: order.branchId,
          description,
          lines: [
            { accountId: settings.manufacturingFeeAccountId, debit: fee, credit: 0, description: `رسوم تصنيع — أمر ${order.orderNumber ?? ''} — ${order.productName ?? ''}` },
            { accountId: settings.supplierControlAccountId, debit: 0, credit: fee, supplierId: order.factorySupplierId, description },
          ],
          actorId,
        },
        manager,
      );
      await this.supplierLedger.record(
        {
          supplierId: order.factorySupplierId,
          transactionDate: date,
          type: SupplierTransactionType.MANUFACTURING_FEE,
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          debit: 0,
          credit: fee,
          description,
          actorId,
        },
        manager,
      );

      order.status = ManufacturingOrderStatus.IN_PROGRESS;
      order.startedAt = order.startedAt ?? new Date();
      order.feeJournalEntryId = journal.id;
      order.feeBookedAt = new Date();
      order.factorySupplierName = supplier.name;
      order.updatedBy = actorId ?? null;
      return manager.getRepository(ManufacturingOrder).save(order);
    });
  }

  // =========================================================
  // CANCEL — reverses a booked fee first
  // =========================================================
  async cancel(orderId: string, actorId?: string, branchScope: string[] | null = null): Promise<ManufacturingOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(ManufacturingOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || !isWithinBranchScope(order.branchId, branchScope)) throw new NotFoundException('لم يتم العثور على أمر التصنيع');
      if (order.status === ManufacturingOrderStatus.CANCELLED) throw new BadRequestException('الأمر ملغى بالفعل');
      if (order.status === ManufacturingOrderStatus.PRODUCED || order.status === ManufacturingOrderStatus.DONE) {
        throw new BadRequestException('لا يمكن إلغاء أمر تم إنتاجه');
      }

      if (order.feeJournalEntryId && order.factorySupplierId) {
        const fee = round2(order.manufacturingFee ?? 0);
        const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
        if (!settings?.supplierControlAccountId || !settings.manufacturingFeeAccountId) {
          throw new BadRequestException('إعدادات المحاسبة غير مكتملة لعكس رسوم التصنيع');
        }
        const date = todayIso();
        const { fiscalYear, period } = await this.resolvePostingContext(date, manager);
        const description = `إلغاء ${this.feeDescription(order)}`;
        await this.journalService.createSystemJournalEntry(
          {
            sourceType: JournalSourceType.MANUFACTURING,
            sourceId: order.id,
            sourceNumber: order.orderNumber,
            entryDate: date,
            fiscalYearId: fiscalYear.id,
            accountingPeriodId: period.id,
            branchId: order.branchId,
            description,
            lines: [
              { accountId: settings.supplierControlAccountId, debit: fee, credit: 0, supplierId: order.factorySupplierId },
              { accountId: settings.manufacturingFeeAccountId, debit: 0, credit: fee },
            ],
            actorId,
            reversalOfJournalEntryId: order.feeJournalEntryId,
          },
          manager,
        );
        await this.supplierLedger.record(
          {
            supplierId: order.factorySupplierId,
            transactionDate: date,
            type: SupplierTransactionType.REVERSAL,
            sourceType: JournalSourceType.MANUFACTURING,
            sourceId: order.id,
            sourceNumber: order.orderNumber,
            debit: fee,
            credit: 0,
            description,
            actorId,
          },
          manager,
        );
      }

      order.status = ManufacturingOrderStatus.CANCELLED;
      order.updatedBy = actorId ?? null;
      return manager.getRepository(ManufacturingOrder).save(order);
    });
  }

  // =========================================================
  // PRODUCE
  // =========================================================
  async produce(
    orderId: string,
    dto: ProduceManufacturingOrderDto,
    actorId?: string,
    branchScope: string[] | null = null,
  ): Promise<ManufacturingOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(ManufacturingOrder, {
        where: { id: orderId },
        relations: { components: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order || !isWithinBranchScope(order.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على أمر التصنيع');
      }
      if (order.status === ManufacturingOrderStatus.PRODUCED) throw new BadRequestException('تم إنتاج هذا الأمر بالفعل');
      if (order.status === ManufacturingOrderStatus.DONE) throw new BadRequestException('الأمر منتهٍ');
      if (order.status === ManufacturingOrderStatus.CANCELLED) throw new BadRequestException('الأمر ملغى');
      if (order.quantity <= 0) throw new BadRequestException('كمية الإنتاج غير صالحة');

      // Components: an optional override at production time, else the stored BOM.
      const components = dto.components?.length
        ? await this.rebuildComponents(order, dto.components, manager)
        : order.components;
      const date = dto.productionDate;
      const warehouseId = dto.warehouseId;

      // Fee/supplier: locked once booked at start; otherwise the production-time values.
      const feeBooked = !!order.feeJournalEntryId;
      const fee = feeBooked ? round2(order.manufacturingFee ?? 0) : round2(dto.manufacturingFee ?? order.manufacturingFee ?? 0);
      const factoryId = feeBooked ? order.factorySupplierId : (dto.factorySupplierId ?? order.factorySupplierId ?? null);
      if (feeBooked) {
        if (dto.manufacturingFee !== undefined && round2(dto.manufacturingFee) !== fee) {
          throw new BadRequestException('رسوم التصنيع مُرحّلة على المورّد عند بدء التنفيذ ولا يمكن تغييرها هنا');
        }
        if (dto.factorySupplierId !== undefined && (dto.factorySupplierId ?? null) !== factoryId) {
          throw new BadRequestException('المورّد مُرحّلة عليه الرسوم عند بدء التنفيذ ولا يمكن تغييره هنا');
        }
      }
      // A production must have something to it: at least components OR a fee.
      if (!components.length && fee <= 0) {
        throw new BadRequestException('لا يمكن التصنيع بدون مكوّنات وبدون رسوم — أضف مكوّنات أو رسوم تصنيع');
      }

      const { fiscalYear, period } = await this.resolvePostingContext(date, manager);
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');

      const product = await manager.getRepository(Product).findOne({ where: { id: order.productId } });
      if (!product) throw new BadRequestException('المنتج المُصنّع غير موجود');
      if (!product.trackInventory) throw new BadRequestException(`المنتج "${product.name}" ليس صنفاً مخزنياً`);

      const finishedAcc = product.inventoryAccountId ?? settings.finishedGoodsInventoryAccountId;
      const rawAcc = settings.rawMaterialInventoryAccountId;
      if (!finishedAcc) throw new BadRequestException('حساب مخزون تام الصنع غير محدد في إعدادات المحاسبة');
      if (!rawAcc) throw new BadRequestException('حساب مخزون المواد الخام غير محدد في إعدادات المحاسبة');

      let supplier: Supplier | null = null;
      if (factoryId) {
        supplier = await manager.getRepository(Supplier).findOne({ where: { id: factoryId } });
        if (!supplier) throw new BadRequestException('المصنع (المورّد) غير موجود');
      }
      // Fee credit: booked-at-start → clear the manufacturing-fee account; factory
      // not yet booked → supplier control; in-house → manufacturing-fee account.
      const bookNow = !feeBooked && !!factoryId;
      const feeAcc = bookNow ? settings.supplierControlAccountId : settings.manufacturingFeeAccountId;
      if (fee > 0 && !feeAcc) {
        throw new BadRequestException(
          bookNow ? 'حساب مراقبة الموردين غير محدد في إعدادات المحاسبة' : 'حساب رسوم التصنيع غير محدد في إعدادات المحاسبة',
        );
      }

      // 1) Consume each component out of ITS OWN warehouse (fallback: the output warehouse).
      const stockLines: StockLineInput[] = components.map((c) => ({
        warehouseId: c.warehouseId ?? warehouseId,
        productId: c.componentProductId,
        productName: c.componentProductName ?? undefined,
        quantity: c.quantity,
      }));
      const issued = await this.stockService.issue(stockLines, manager, {
        movementType: StockMovementType.MANUFACTURING,
        sourceType: JournalSourceType.MANUFACTURING,
        sourceId: order.id,
        sourceNumber: order.orderNumber,
        movementDate: date,
        actorId,
      });
      components.forEach((c, i) => {
        c.unitCost = issued[i].unitCost;
        c.lineCost = round2(c.quantity * issued[i].unitCost);
      });
      const componentCost = round2(components.reduce((s, c) => s + c.lineCost, 0));
      // Cost = consumed components + manufacturing fee. The manufactured product's
      // own master cost price is NOT used — its value is what goes into it here.
      const totalCost = round2(componentCost + fee);
      const unitCost = round2(totalCost / order.quantity);

      // 2) Produce the finished product into the warehouse at the computed cost.
      await this.stockService.receive(
        [{ warehouseId, productId: order.productId, productName: order.productName ?? undefined, quantity: order.quantity, unitCost }],
        manager,
        {
          movementType: StockMovementType.MANUFACTURING,
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          movementDate: date,
          actorId,
        },
      );

      // 3) Production journal — DR finished goods (total); CR raw materials
      //    (components); CR the fee (clearing account when booked at start).
      const orderRef = `أمر تصنيع ${order.orderNumber ?? ''}`;
      const lines: JournalLineInput[] = [
        { accountId: finishedAcc, debit: totalCost, credit: 0, productId: order.productId, warehouseId, description: `إنتاج ${order.productName ?? ''} (${order.quantity}) — ${orderRef}` },
      ];
      if (componentCost > 0) lines.push({ accountId: rawAcc, debit: 0, credit: componentCost, warehouseId, description: `صرف خامات للإنتاج — ${orderRef}` });
      if (fee > 0) {
        lines.push({
          accountId: feeAcc!,
          debit: 0,
          credit: fee,
          supplierId: bookNow ? factoryId! : undefined,
          description: bookNow ? `رسوم تصنيع مستحقة للمورد — ${orderRef}` : `تحميل رسوم التصنيع على المنتج — ${orderRef}`,
        });
      }
      const journal = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          entryDate: date,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: order.branchId,
          description: `أمر تصنيع ${order.orderNumber ?? ''} — إنتاج ${order.productName ?? ''} — العميل: ${order.customerName ?? '—'} — فاتورة: ${order.sourceNumber ?? '—'}`,
          lines,
          actorId,
        },
        manager,
      );

      // 4) Factory payable — only when it was NOT already booked at start.
      if (bookNow && fee > 0) {
        await this.supplierLedger.record(
          {
            supplierId: factoryId!,
            transactionDate: date,
            type: SupplierTransactionType.MANUFACTURING_FEE,
            sourceType: JournalSourceType.MANUFACTURING,
            sourceId: order.id,
            sourceNumber: order.orderNumber,
            debit: 0,
            credit: fee,
            description: this.feeDescription(order),
            actorId,
          },
          manager,
        );
      }

      // 5) Persist the order + components.
      await manager.getRepository(ManufacturingOrderComponent).save(components);
      order.status = ManufacturingOrderStatus.PRODUCED;
      order.warehouseId = warehouseId;
      order.manufacturingFee = fee;
      order.factorySupplierId = factoryId;
      order.factorySupplierName = supplier?.name ?? order.factorySupplierName ?? null;
      order.totalCost = totalCost;
      order.journalEntryId = journal.id;
      order.accountingPeriodId = period.id;
      order.producedAt = new Date();
      if (!order.startedAt) order.startedAt = new Date();
      order.updatedBy = actorId ?? null;
      await manager.getRepository(ManufacturingOrder).save(order);

      // 6) Hand the produced goods to the linked delivery line.
      await this.linkDeliveryLine(order, warehouseId, manager);

      return manager.findOne(ManufacturingOrder, {
        where: { id: orderId },
        relations: { components: true },
      }) as Promise<ManufacturingOrder>;
    });
  }

  /** Replace the stored components with an at-production override. */
  private async rebuildComponents(
    order: ManufacturingOrder,
    override: ProduceManufacturingOrderDto['components'],
    manager: EntityManager,
  ): Promise<ManufacturingOrderComponent[]> {
    const compRepo = manager.getRepository(ManufacturingOrderComponent);
    await compRepo.delete({ manufacturingOrderId: order.id });
    const ids = override!.map((c) => c.componentProductId);
    const products = await manager.getRepository(Product).find({ where: { id: In(ids) }, relations: { unit: true } });
    const pMap = new Map(products.map((p): [string, Product] => [p.id, p]));
    const rows = override!.map((c, i) =>
      compRepo.create({
        manufacturingOrderId: order.id,
        lineNumber: i + 1,
        componentProductId: c.componentProductId,
        componentProductName: pMap.get(c.componentProductId)?.name ?? null,
        unitName: pMap.get(c.componentProductId)?.unit?.name ?? null,
        quantity: round3(c.quantity),
        warehouseId: c.warehouseId ?? null,
      }),
    );
    return compRepo.save(rows);
  }

  /** Assign the produced warehouse to the manufacturing delivery line so it can
   *  now be confirmed (issued) like a stock line. */
  private async linkDeliveryLine(order: ManufacturingOrder, warehouseId: string, manager: EntityManager): Promise<void> {
    if (!order.salesInvoiceItemId) return;
    const repo = manager.getRepository(SalesDeliveryItem);
    const items = await repo.find({
      where: { salesInvoiceItemId: order.salesInvoiceItemId, lineType: SalesLineType.MANUFACTURING },
    });
    for (const it of items) {
      it.warehouseId = warehouseId;
      it.manufacturingOrderId = order.id;
    }
    if (items.length) await repo.save(items);
  }

  private async resolvePostingContext(
    date: string,
    manager: EntityManager,
  ): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const period = await manager
      .getRepository(AccountingPeriod)
      .createQueryBuilder('p')
      .where('p.startDate <= :d AND p.endDate >= :d', { d: date })
      .andWhere('p.isClosed = false')
      .getOne();
    if (!period) throw new BadRequestException('لا توجد فترة محاسبية مفتوحة تشمل هذا التاريخ');
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: period.fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    return { fiscalYear, period };
  }
}
