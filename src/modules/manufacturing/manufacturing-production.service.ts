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

/**
 * Executes production of a manufacturing order (ONE transaction):
 *  1. issue the BOM components out of the warehouse at weighted-average cost,
 *  2. produce the finished product INTO the warehouse at (components + fee) cost,
 *  3. book DR finished-goods inventory / CR raw-material inventory + CR the fee
 *     (supplier control for a factory order, else the manufacturing-fee account),
 *  4. for a factory order, record the fee as a payable to that supplier,
 *  5. assign the produced warehouse to the linked sales delivery line so it
 *     becomes confirmable.
 */
@Injectable()
export class ManufacturingProductionService {
  constructor(
    private readonly stockService: StockService,
    private readonly journalService: JournalEntryService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly dataSource: DataSource,
  ) {}

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
      if (!components.length) throw new BadRequestException('لا توجد مكوّنات لهذا الأمر — أضف مكوّنات التصنيع أولاً');

      const date = dto.productionDate;
      const warehouseId = dto.warehouseId;
      const fee = round2(dto.manufacturingFee ?? order.manufacturingFee ?? 0);
      const factoryId = dto.factorySupplierId ?? order.factorySupplierId ?? null;

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
      const feeAcc = factoryId ? settings.supplierControlAccountId : settings.manufacturingFeeAccountId;
      if (fee > 0 && !feeAcc) {
        throw new BadRequestException(
          factoryId
            ? 'حساب مراقبة الموردين غير محدد في إعدادات المحاسبة'
            : 'حساب رسوم التصنيع غير محدد في إعدادات المحاسبة',
        );
      }

      // 1) Consume the components out of the warehouse.
      const stockLines: StockLineInput[] = components.map((c) => ({
        warehouseId,
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

      // 3) Book the production journal.
      const lines: JournalLineInput[] = [
        { accountId: finishedAcc, debit: totalCost, credit: 0, productId: order.productId, warehouseId },
      ];
      if (componentCost > 0) lines.push({ accountId: rawAcc, debit: 0, credit: componentCost, warehouseId });
      if (fee > 0) lines.push({ accountId: feeAcc!, debit: 0, credit: fee, supplierId: factoryId ?? undefined });
      const journal = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          entryDate: date,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: order.branchId,
          description: `أمر تصنيع ${order.orderNumber ?? ''} — إنتاج ${order.productName ?? ''}`,
          lines,
          actorId,
        },
        manager,
      );

      // 4) Factory (supplier) payable for the fee.
      if (factoryId && fee > 0) {
        await this.supplierLedger.record(
          {
            supplierId: factoryId,
            transactionDate: date,
            type: SupplierTransactionType.MANUFACTURING_FEE,
            sourceType: JournalSourceType.MANUFACTURING,
            sourceId: order.id,
            sourceNumber: order.orderNumber,
            debit: 0,
            credit: fee,
            description: `رسوم تصنيع أمر ${order.orderNumber ?? ''}`,
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
      order.factorySupplierName = supplier?.name ?? null;
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
    if (!period) throw new BadRequestException('لا توجد فترة محاسبية مفتوحة تشمل تاريخ الإنتاج');
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: period.fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    return { fiscalYear, period };
  }
}
