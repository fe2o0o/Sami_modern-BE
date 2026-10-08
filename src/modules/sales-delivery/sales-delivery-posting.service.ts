import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { isWithinBranchScope } from "../../common/utils/branch-scope.util";
import { SalesDelivery } from './entities/sales-delivery.entity';
import { SalesDeliveryItem } from './entities/sales-delivery-item.entity';
import {
  SalesDeliveryProgress,
  SalesDeliverySource,
  SalesDeliveryStatus,
} from './enums/sales-delivery.enum';
import { ReverseSalesDeliveryDto } from './dto/reverse-sales-delivery.dto';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceItemComponent } from '../sales-invoice/entities/sales-invoice-item-component.entity';
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import { SalesReturnService } from '../sales-return/sales-return.service';
import { SalesReturnPostingService } from '../sales-return/sales-return-posting.service';
import {
  SalesDeliveryStatus as InvoiceDeliveryStatus,
  SalesLineType,
} from '../sales-invoice/enums/sales-invoice.enum';
import { Product } from '../product/entities/product.entity';
import { applyEffectiveAccounts } from '../product/product-accounts';
import { ProductType } from '../product/enums/product-type.enum';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { ManufacturingOrderStatus } from '../manufacturing/enums/manufacturing.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import { JournalEntryService, JournalLineInput } from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { JournalLineBuilder } from '../journal-entry/journal-line-builder';
import { Customer } from '../customer/entities/customer.entity';
import { missingAccountMessage } from '../product/product-accounts';

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v: number): number { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

/**
 * The stock/accounting side-effects of a delivery note. On posting (ONE txn):
 * stock is physically issued at weighted-average cost, the cost of sales is
 * booked (DR COGS / CR inventory), and — for an invoice-linked delivery — the
 * invoice's reservation is released and its delivery progress advanced.
 */
@Injectable()
export class SalesDeliveryPostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
    private readonly manufacturingService: ManufacturingService,
    private readonly salesReturnService: SalesReturnService,
    private readonly salesReturnPosting: SalesReturnPostingService,
  ) {}

  async post(id: string, actorId?: string, branchScope: string[] | null = null): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, id);
      if (!isWithinBranchScope(delivery.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      if (delivery.status !== SalesDeliveryStatus.DRAFT) throw new BadRequestException('لا يمكن ترحيل إذن تسليم غير مسودة');
      if (!delivery.items?.length) throw new BadRequestException('لا يمكن ترحيل إذن تسليم بدون أصناف');
      // An invoice-linked delivery ORDER is confirmed line by line (deliverItem);
      // posting it as a whole would issue its legacy `quantity` (0) and mark it
      // delivered without moving anything.
      if (delivery.source === SalesDeliverySource.INVOICE) {
        throw new BadRequestException('إذن التسليم المرتبط بفاتورة يُؤكَّد سطراً بسطر (تأكيد تسليم كل صنف) ولا يُرحَّل دفعة واحدة');
      }
      if (delivery.items.some((i) => (i.quantity || 0) <= 0)) {
        throw new BadRequestException('لا يمكن ترحيل إذن تسليم يحتوي على أصناف بكمية صفر');
      }

      const { fiscalYear } = await this.assertOpenPostingContext(
        delivery.fiscalYearId, delivery.accountingPeriodId, delivery.deliveryDate, manager,
      );
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      const products = await this.loadProducts(delivery.items.map((i) => i.productId), manager);
      this.validateAccounts(delivery, products, settings);

      const number = await this.sequenceService.nextDocumentNumber('DN', fiscalYear, manager);

      // Physically issue the goods at weighted-average cost. allowNegative keeps
      // the flexible "sell then procure" flow working.
      const stockLines: StockLineInput[] = delivery.items.map((i) => ({
        warehouseId: i.warehouseId!,
        productId: i.productId,
        productName: i.productName ?? undefined,
        quantity: i.quantity,
      }));
      const issued = await this.stockService.issue(stockLines, manager, {
        movementType: StockMovementType.SALE,
        sourceType: JournalSourceType.SALES_DELIVERY,
        sourceId: delivery.id,
        sourceNumber: number,
        movementDate: delivery.deliveryDate,
        actorId,
        // Standalone note: only FREE stock (not reserved for invoices) can leave;
        // the warehouse's negative-stock policy does not override reservations.
        respectReservations: true,
      });
      delivery.items.forEach((item, idx) => {
        item.unitCostAtPost = issued[idx].unitCost;
        item.lineCost = round2(item.quantity * issued[idx].unitCost);
      });
      delivery.totalCost = round2(delivery.items.reduce((s, i) => s + i.lineCost, 0));

      // (Invoice-linked orders never reach this point — they are confirmed per
      //  line in deliverItem, which releases the reservation and advances the
      //  invoice's delivery progress there.)

      // Book the cost of sales: DR COGS / CR inventory.
      const lines = this.buildJournalLines(delivery, products, settings, number);
      if (lines.length) {
        const customerName = await this.customerName(delivery.customerId, manager);
        const journalEntry = await this.journalService.createSystemJournalEntry(
          {
            sourceType: JournalSourceType.SALES_DELIVERY,
            sourceId: delivery.id,
            sourceNumber: number,
            entryDate: delivery.deliveryDate,
            fiscalYearId: delivery.fiscalYearId,
            accountingPeriodId: delivery.accountingPeriodId,
            branchId: delivery.branchId,
            description: `تكلفة مبيعات — إذن تسليم ${number}${delivery.invoiceNumber ? ` — فاتورة ${delivery.invoiceNumber}` : ''} — العميل: ${customerName}`,
            lines,
            actorId,
          },
          manager,
        );
        delivery.journalEntryId = journalEntry.id;
      }

      delivery.deliveryNumber = number;
      delivery.status = SalesDeliveryStatus.POSTED;
      delivery.postedAt = new Date();
      delivery.postedBy = actorId ?? null;
      delivery.updatedBy = actorId ?? null;

      await manager.getRepository(SalesDelivery).save(delivery);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReverseSalesDeliveryDto, actorId?: string, branchScope: string[] | null = null): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, id);
      if (!isWithinBranchScope(delivery.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      if (delivery.status === SalesDeliveryStatus.REVERSED) throw new ConflictException('إذن التسليم معكوس بالفعل');
      if (delivery.status !== SalesDeliveryStatus.POSTED) throw new BadRequestException('لا يمكن عكس إذن تسليم غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate, 'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      // Receive the goods back at their original issue cost.
      await this.stockService.receive(
        delivery.items.map((i) => ({ warehouseId: i.warehouseId!, productId: i.productId, quantity: i.quantity, unitCost: i.unitCostAtPost })),
        manager,
        {
          movementType: StockMovementType.SALE_REVERSAL,
          sourceType: JournalSourceType.SALES_DELIVERY,
          sourceId: delivery.id,
          sourceNumber: delivery.deliveryNumber,
          movementDate: dto.reversalDate,
          actorId,
        },
      );

      // Invoice-linked: re-hold the reservation and roll delivery progress back.
      if (delivery.source === SalesDeliverySource.INVOICE && delivery.salesInvoiceId) {
        await this.stockService.reserve(
          delivery.items.map((i) => ({ warehouseId: i.warehouseId!, productId: i.productId, quantity: i.quantity })),
          manager,
        );
        await this.applyInvoiceDelivery(manager, delivery, -1);
      }

      // Reverse the COGS journal, if one was posted.
      if (delivery.journalEntryId) {
        const original = await this.journalService.findWithLines(delivery.journalEntryId);
        if (original) {
          const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
            description: l.description ? `عكس: ${l.description}` : 'عكس إذن تسليم',
          }));
          const reversalEntry = await this.journalService.createSystemJournalEntry(
            {
              sourceType: JournalSourceType.SALES_DELIVERY,
              sourceId: delivery.id,
              sourceNumber: delivery.deliveryNumber,
              entryDate: dto.reversalDate,
              fiscalYearId: period.fiscalYearId,
              accountingPeriodId: period.id,
              branchId: delivery.branchId,
              description: `عكس إذن تسليم ${delivery.deliveryNumber ?? ''} — ${dto.reason}`,
              reversalOfJournalEntryId: original.id,
              lines: reversalLines,
              actorId,
            },
            manager,
          );
          await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);
          delivery.reversalJournalEntryId = reversalEntry.id;
        }
      }

      delivery.status = SalesDeliveryStatus.REVERSED;
      delivery.reversedAt = new Date();
      delivery.reversedBy = actorId ?? null;
      delivery.reversalReason = dto.reason;
      delivery.updatedBy = actorId ?? null;

      await manager.getRepository(SalesDelivery).save(delivery);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // PER-LINE CONFIRMATION (living delivery order)
  // =========================================================
  /**
   * Confirm delivery of ONE line for a quantity (default: the full remaining),
   * on the ACTUAL delivery date. Issues the stock at weighted-average cost,
   * releases the invoice reservation, books DR COGS / CR inventory dated on the
   * actual date, and advances the order + invoice progress.
   */
  async confirmLine(
    deliveryId: string,
    itemId: string,
    quantity: number | undefined,
    actualDate: string,
    actorId?: string,
    branchScope: string[] | null = null,
    fromWarehouseId?: string,
  ): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, deliveryId);
      if (!isWithinBranchScope(delivery.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      const item = delivery.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('السطر غير موجود في إذن التسليم');
      if (item.lineType === SalesLineType.SERVICE) {
        throw new BadRequestException('سطر خدمة لا يُسلَّم');
      }
      // A manufacturing line is deliverable only once its production order is
      // produced (the finished goods are then in the warehouse assigned to it).
      if (item.lineType === SalesLineType.MANUFACTURING) {
        const mo = item.manufacturingOrderId
          ? await manager.getRepository(ManufacturingOrder).findOne({ where: { id: item.manufacturingOrderId } })
          : null; // soft-deleted orders come back null
        const produced =
          mo && (mo.status === ManufacturingOrderStatus.PRODUCED || mo.status === ManufacturingOrderStatus.DONE);
        const orderGone = !mo || mo.status === ManufacturingOrderStatus.CANCELLED;
        if (!produced) {
          if (orderGone && fromWarehouseId) {
            // Production order cancelled/deleted → deliver the finished product
            // from stock instead (issue() below checks the availability).
            item.warehouseId = fromWarehouseId;
          } else if (orderGone) {
            throw new BadRequestException(
              'أمر التصنيع لهذا الصنف ملغى أو محذوف — أنشئ أمر تصنيع جديداً للسطر، أو سلّمه من المخزون باختيار المخزن',
            );
          } else {
            throw new BadRequestException(`صنف تصنيع — بانتظار الإنتاج (أمر ${mo!.orderNumber ?? ''})، لا يمكن تسليمه بعد`);
          }
        } else if (!item.warehouseId) {
          throw new BadRequestException('صنف تصنيع — لم يُحدَّد مخزن الإنتاج بعد');
        }
      }
      if (!item.warehouseId) throw new BadRequestException('لم يُحدَّد مخزن لهذا السطر');
      const remaining = round3((item.orderedQuantity ?? 0) - (item.deliveredQuantity ?? 0) - (item.cancelledQuantity ?? 0));
      const qty = round3(quantity ?? remaining);
      if (qty <= 0) throw new BadRequestException('لا توجد كمية متبقية للتسليم');
      if (qty - remaining > 1e-6) throw new BadRequestException(`الكمية تتجاوز المتبقي (${remaining})`);

      const { fiscalYear, period } = await this.resolvePostingContext(actualDate, manager);
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      const product = (await this.loadProducts([item.productId], manager)).get(item.productId);
      if (!product) throw new BadRequestException('المنتج غير موجود');
      if (!product.trackInventory) throw new BadRequestException(`المنتج "${product.name}" ليس صنفاً مخزنياً`);
      const cogsAcc = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId;
      const invAcc = this.resolveInventoryAccount(product, settings);
      if (!cogsAcc) throw new BadRequestException(missingAccountMessage('cogs', product.name));
      if (!invAcc) throw new BadRequestException(missingAccountMessage('inventory', product.name));

      const number = delivery.deliveryNumber ?? (await this.sequenceService.nextDocumentNumber('DN', fiscalYear, manager));
      const stockLine: StockLineInput[] = [
        { warehouseId: item.warehouseId!, productId: item.productId, productName: item.productName ?? undefined, quantity: qty },
      ];
      const issued = await this.stockService.issue(stockLine, manager, {
        movementType: StockMovementType.SALE,
        sourceType: JournalSourceType.SALES_DELIVERY,
        sourceId: delivery.id,
        sourceNumber: number,
        movementDate: actualDate,
        actorId,
        // Physical availability is required (the line consumes its OWN reservation,
        // so reservations aren't deducted). Delivering from an empty shelf used to
        // drive stock negative at zero cost; now only a warehouse configured
        // «يسمح بالرصيد السالب» allows it.
      });
      const unitCost = issued[0].unitCost;
      const lineCost = round2(qty * unitCost);

      if (delivery.salesInvoiceId && item.salesInvoiceItemId) {
        await this.stockService.releaseReservation(stockLine, manager);
      }

      const customerName = await this.customerName(delivery.customerId, manager);
      const itemRef = `${product.name ?? ''} (${qty}) — إذن تسليم ${number}`;
      // A zero weighted-average cost (goods sold before any costed receipt, or an
      // opening balance entered without a cost) means there is no COGS to book:
      // the goods still leave the warehouse, the journal is simply skipped.
      // Invoice-accrued cost (if the invoice booked COGS at posting): this delivery
      // clears its share of «بضاعة مباعة لم تُسلَّم»; the gap to the ACTUAL issue
      // cost goes to COGS. No accrual (legacy / clearing account not set) → the
      // whole actual cost is COGS, exactly as before.
      let accrualPortion = 0;
      let invItemForAccrual: SalesInvoiceItem | null = null;
      if (item.salesInvoiceItemId) {
        invItemForAccrual = await manager.getRepository(SalesInvoiceItem).findOne({ where: { id: item.salesInvoiceItemId } });
        const unsettled = round2((Number(invItemForAccrual?.cogsAccrued) || 0) - (Number(invItemForAccrual?.cogsAccruedSettled) || 0));
        if (unsettled > 0 && remaining > 0) {
          accrualPortion = qty + 1e-6 >= remaining ? unsettled : round2((unsettled * qty) / remaining);
        }
      }
      const variance = round2(lineCost - accrualPortion);
      const deliveryLines: JournalLineInput[] = [];
      if (accrualPortion > 0) {
        if (!settings.goodsSoldNotDeliveredAccountId) {
          throw new BadRequestException('حساب «بضاعة مباعة لم تُسلَّم» غير محدد في إعدادات المحاسبة');
        }
        deliveryLines.push({ accountId: settings.goodsSoldNotDeliveredAccountId, debit: accrualPortion, credit: 0, productId: item.productId, description: `تسوية بضاعة مباعة لم تُسلَّم — ${itemRef}` });
      }
      if (variance > 0) deliveryLines.push({ accountId: cogsAcc, debit: variance, credit: 0, description: accrualPortion > 0 ? `فرق تكلفة فعلية عن المقدّرة — ${itemRef}` : `تكلفة تسليم ${itemRef}`, productId: item.productId, warehouseId: item.warehouseId });
      if (variance < 0) deliveryLines.push({ accountId: cogsAcc, debit: 0, credit: -variance, description: `فرق تكلفة فعلية عن المقدّرة — ${itemRef}`, productId: item.productId, warehouseId: item.warehouseId });
      if (lineCost > 0) deliveryLines.push({ accountId: invAcc, debit: 0, credit: lineCost, description: `صرف من المخزن ${itemRef}`, productId: item.productId, warehouseId: item.warehouseId });
      if (deliveryLines.length) await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.SALES_DELIVERY,
          sourceId: delivery.id,
          sourceNumber: number,
          entryDate: actualDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: delivery.branchId,
          description: `تسليم ${itemRef}${delivery.invoiceNumber ? ` — فاتورة ${delivery.invoiceNumber}` : ''} — العميل: ${customerName}`,
          lines: deliveryLines,
          actorId,
        },
        manager,
      );

      item.deliveredQuantity = round3((item.deliveredQuantity ?? 0) + qty);
      item.quantity = item.deliveredQuantity; // keep legacy field in sync
      item.lineCost = round2((item.lineCost ?? 0) + lineCost);
      item.unitCostAtPost = unitCost;
      item.actualDeliveryDate = actualDate;

      if (accrualPortion > 0 && invItemForAccrual) {
        item.cogsAccrualSettled = round2((Number(item.cogsAccrualSettled) || 0) + accrualPortion);
        invItemForAccrual.cogsAccruedSettled = round2((Number(invItemForAccrual.cogsAccruedSettled) || 0) + accrualPortion);
        await manager.getRepository(SalesInvoiceItem).save(invItemForAccrual);
      }

      // A fully-delivered manufacturing line closes its production order.
      await this.syncManufacturingDone(manager, item, actorId);

      if (delivery.salesInvoiceId && item.salesInvoiceItemId) {
        await this.applyInvoiceLineDelivery(manager, delivery.salesInvoiceId, item.salesInvoiceItemId, qty);
      }

      delivery.deliveryNumber = number;
      delivery.totalCost = round2(delivery.items.reduce((s, i) => s + (i.lineCost ?? 0), 0));
      delivery.deliveryProgress = this.computeProgress(delivery.items);
      delivery.updatedBy = actorId ?? null;
      await manager.getRepository(SalesDelivery).save(delivery);
      return this.reload(manager, deliveryId);
    });
  }

  /** Undo a confirmed line: receive the goods back, re-reserve, reverse its COGS. */
  async reverseLine(
    deliveryId: string,
    itemId: string,
    reversalDate: string,
    actorId?: string,
    branchScope: string[] | null = null,
  ): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, deliveryId);
      if (!isWithinBranchScope(delivery.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      const item = delivery.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('السطر غير موجود في إذن التسليم');
      const qty = round3(item.deliveredQuantity ?? 0);
      if (qty <= 0) throw new BadRequestException('السطر غير مُسلّم');
      const cost = round2(item.lineCost ?? 0);
      const { fiscalYear, period } = await this.resolvePostingContext(reversalDate, manager);

      await this.stockService.receive(
        [{ warehouseId: item.warehouseId!, productId: item.productId, quantity: qty, unitCost: item.unitCostAtPost }],
        manager,
        {
          movementType: StockMovementType.SALE_REVERSAL,
          sourceType: JournalSourceType.SALES_DELIVERY,
          sourceId: delivery.id,
          sourceNumber: delivery.deliveryNumber,
          movementDate: reversalDate,
          actorId,
        },
      );
      if (delivery.salesInvoiceId && item.salesInvoiceItemId) {
        await this.stockService.reserve(
          [{ warehouseId: item.warehouseId!, productId: item.productId, quantity: qty }],
          manager,
        );
        await this.applyInvoiceLineDelivery(manager, delivery.salesInvoiceId, item.salesInvoiceItemId, -qty);
      }
      // Restore the invoice accrual this line had cleared (the goods are owed again).
      const accrualBack = round2(Number(item.cogsAccrualSettled) || 0);
      if (cost > 0 || accrualBack > 0) {
        const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
        const product = (await this.loadProducts([item.productId], manager)).get(item.productId)!;
        const cogsAcc = product.cogsAccountId ?? settings!.costOfGoodsSoldAccountId!;
        const invAcc = this.resolveInventoryAccount(product, settings!)!;
        await this.journalService.createSystemJournalEntry(
          {
            sourceType: JournalSourceType.SALES_DELIVERY,
            sourceId: delivery.id,
            sourceNumber: delivery.deliveryNumber,
            entryDate: reversalDate,
            fiscalYearId: fiscalYear.id,
            accountingPeriodId: period.id,
            branchId: delivery.branchId,
            description: `عكس تسليم ${product.name ?? ''} — ${delivery.deliveryNumber ?? ''}`,
            lines: ((): JournalLineInput[] => {
              const out: JournalLineInput[] = [];
              const variance = round2(cost - accrualBack);
              if (cost > 0) out.push({ accountId: invAcc, debit: cost, credit: 0, productId: item.productId, warehouseId: item.warehouseId });
              if (accrualBack > 0) {
                if (!settings!.goodsSoldNotDeliveredAccountId) throw new BadRequestException('حساب «بضاعة مباعة لم تُسلَّم» غير محدد في إعدادات المحاسبة');
                out.push({ accountId: settings!.goodsSoldNotDeliveredAccountId, debit: 0, credit: accrualBack, productId: item.productId });
              }
              if (variance > 0) out.push({ accountId: cogsAcc, debit: 0, credit: variance, productId: item.productId });
              if (variance < 0) out.push({ accountId: cogsAcc, debit: -variance, credit: 0, productId: item.productId });
              return out;
            })(),
            actorId,
          },
          manager,
        );
      }

      if (accrualBack > 0 && item.salesInvoiceItemId) {
        const invRepo = manager.getRepository(SalesInvoiceItem);
        const inv = await invRepo.findOne({ where: { id: item.salesInvoiceItemId } });
        if (inv) {
          inv.cogsAccruedSettled = round2(Math.max(0, (Number(inv.cogsAccruedSettled) || 0) - accrualBack));
          await invRepo.save(inv);
        }
      }
      item.cogsAccrualSettled = 0;
      item.deliveredQuantity = 0;
      item.quantity = 0;
      item.lineCost = 0;
      item.actualDeliveryDate = null;
      // A reversed manufacturing line is no longer fully delivered → reopen its order.
      await this.syncManufacturingDone(manager, item, actorId);
      delivery.totalCost = round2(delivery.items.reduce((s, i) => s + (i.lineCost ?? 0), 0));
      delivery.deliveryProgress = this.computeProgress(delivery.items);
      delivery.updatedBy = actorId ?? null;
      await manager.getRepository(SalesDelivery).save(delivery);
      return this.reload(manager, deliveryId);
    });
  }

  /** Auto-close (or re-open) a manufacturing line's production order to match its
   *  delivery: fully delivered → DONE, otherwise back to PRODUCED. */
  private async syncManufacturingDone(
    manager: EntityManager,
    item: SalesDeliveryItem,
    actorId?: string,
  ): Promise<void> {
    if (item.lineType !== SalesLineType.MANUFACTURING || !item.manufacturingOrderId) return;
    const repo = manager.getRepository(ManufacturingOrder);
    const mo = await repo.findOne({ where: { id: item.manufacturingOrderId } });
    if (!mo) return;
    const fullyDelivered = (item.deliveredQuantity ?? 0) + (item.cancelledQuantity ?? 0) + 1e-6 >= (item.orderedQuantity ?? 0);
    if (fullyDelivered && mo.status === ManufacturingOrderStatus.PRODUCED) {
      mo.status = ManufacturingOrderStatus.DONE;
      mo.doneAt = new Date();
      mo.updatedBy = actorId ?? null;
      await repo.save(mo);
    } else if (!fullyDelivered && mo.status === ManufacturingOrderStatus.DONE) {
      mo.status = ManufacturingOrderStatus.PRODUCED;
      mo.doneAt = null;
      mo.updatedBy = actorId ?? null;
      await repo.save(mo);
    }
  }

  /** Order progress from its stock lines' delivered vs ordered quantities. */
  private computeProgress(items: SalesDeliveryItem[]): SalesDeliveryProgress {
    // Deliverable goods = stock + manufacturing lines (service lines don't ship).
    const stock = items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    if (!stock.length) return SalesDeliveryProgress.PENDING;
    const anyDelivered = stock.some((i) => (i.deliveredQuantity ?? 0) > 1e-6);
    // A cancelled quantity counts as closed (it will never ship).
    const allDelivered = stock.every((i) => (i.deliveredQuantity ?? 0) + (i.cancelledQuantity ?? 0) + 1e-6 >= (i.orderedQuantity ?? 0));
    return allDelivered
      ? SalesDeliveryProgress.DELIVERED
      : anyDelivered
        ? SalesDeliveryProgress.PARTIAL
        : SalesDeliveryProgress.PENDING;
  }

  /** Bump one invoice line's delivered quantity and recompute the invoice's status. */
  private async applyInvoiceLineDelivery(
    manager: EntityManager,
    invoiceId: string,
    salesInvoiceItemId: string,
    deltaQty: number,
  ): Promise<void> {
    const invoice = await manager.getRepository(SalesInvoice).findOne({
      where: { id: invoiceId },
      relations: { items: true },
    });
    if (!invoice) return;
    const inv = invoice.items.find((i) => i.id === salesInvoiceItemId);
    if (inv) {
      inv.deliveredQuantity = round3(Math.max(0, (inv.deliveredQuantity ?? 0) + deltaQty));
      await manager.getRepository(SalesInvoiceItem).save(inv);
    }
    const stockItems = invoice.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    // Quantities cancelled on the delivery order (credited by a return) are closed too.
    const cancelledRows = stockItems.length
      ? await manager.getRepository(SalesDeliveryItem).find({
          where: { salesInvoiceItemId: In(stockItems.map((i) => i.id)) },
          select: { id: true, salesInvoiceItemId: true, cancelledQuantity: true },
        })
      : [];
    const cancelledBy = new Map<string, number>();
    for (const r of cancelledRows) {
      if (r.salesInvoiceItemId) cancelledBy.set(r.salesInvoiceItemId, (cancelledBy.get(r.salesInvoiceItemId) ?? 0) + (Number(r.cancelledQuantity) || 0));
    }
    const anyDelivered = stockItems.some((i) => (i.deliveredQuantity ?? 0) > 1e-6);
    const allDelivered =
      stockItems.length > 0 &&
      stockItems.every((i) => (i.deliveredQuantity ?? 0) + (cancelledBy.get(i.id) ?? 0) + 1e-6 >= i.quantity);
    invoice.deliveryStatus = !stockItems.length
      ? InvoiceDeliveryStatus.NOT_APPLICABLE
      : allDelivered
        ? InvoiceDeliveryStatus.DELIVERED
        : anyDelivered
          ? InvoiceDeliveryStatus.PARTIAL
          : InvoiceDeliveryStatus.PENDING;
    await manager.getRepository(SalesInvoice).save(invoice);
  }

  /** Find the open accounting period + fiscal year that contains a date. */
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
    if (!period) throw new BadRequestException('لا توجد فترة محاسبية مفتوحة تشمل تاريخ التسليم');
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: period.fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    return { fiscalYear, period };
  }

  // =========================================================
  // INVOICE DELIVERY PROGRESS
  // =========================================================
  /** Add (sign +1 on post) or roll back (-1 on reverse) delivered quantities on the linked invoice. */
  private async applyInvoiceDelivery(manager: EntityManager, delivery: SalesDelivery, sign: 1 | -1): Promise<void> {
    const invoice = await manager.getRepository(SalesInvoice).findOne({
      where: { id: delivery.salesInvoiceId! },
      relations: { items: true },
    });
    if (!invoice) return;
    const itemById = new Map(invoice.items.map((i) => [i.id, i]));
    for (const line of delivery.items) {
      if (!line.salesInvoiceItemId) continue;
      const inv = itemById.get(line.salesInvoiceItemId);
      if (!inv) continue;
      inv.deliveredQuantity = round3(Math.max(0, (inv.deliveredQuantity ?? 0) + sign * line.quantity));
    }
    await manager.getRepository(SalesInvoiceItem).save(invoice.items);

    const stockItems = invoice.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    // Quantities cancelled on the delivery order (credited by a return) are closed too.
    const cancelledRows = stockItems.length
      ? await manager.getRepository(SalesDeliveryItem).find({
          where: { salesInvoiceItemId: In(stockItems.map((i) => i.id)) },
          select: { id: true, salesInvoiceItemId: true, cancelledQuantity: true },
        })
      : [];
    const cancelledBy = new Map<string, number>();
    for (const r of cancelledRows) {
      if (r.salesInvoiceItemId) cancelledBy.set(r.salesInvoiceItemId, (cancelledBy.get(r.salesInvoiceItemId) ?? 0) + (Number(r.cancelledQuantity) || 0));
    }
    const anyDelivered = stockItems.some((i) => (i.deliveredQuantity ?? 0) > 1e-6);
    const allDelivered =
      stockItems.length > 0 &&
      stockItems.every((i) => (i.deliveredQuantity ?? 0) + (cancelledBy.get(i.id) ?? 0) + 1e-6 >= i.quantity);
    invoice.deliveryStatus = !stockItems.length
      ? InvoiceDeliveryStatus.NOT_APPLICABLE
      : allDelivered
        ? InvoiceDeliveryStatus.DELIVERED
        : anyDelivered
          ? InvoiceDeliveryStatus.PARTIAL
          : InvoiceDeliveryStatus.PENDING;
    await manager.getRepository(SalesInvoice).save(invoice);
  }

  // =========================================================
  // ACCOUNTING
  // =========================================================
  private buildJournalLines(delivery: SalesDelivery, products: Map<string, Product>, settings: AccountingSetting, number: string): JournalLineInput[] {
    const b = new JournalLineBuilder();
    const ref = `إذن تسليم ${number}`;
    for (const item of delivery.items) {
      if (item.lineCost <= 0) continue;
      const product = products.get(item.productId)!;
      const cogs = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      const inventory = this.resolveInventoryAccount(product, settings)!;
      b.add(cogs, item.lineCost, 0, `تكلفة البضاعة المباعة — ${ref}`);
      b.add(inventory, 0, item.lineCost, `صرف بضاعة من المخزن — ${ref}`, { warehouseId: item.warehouseId });
    }
    return b.build();
  }

  private async customerName(customerId: string | null, manager: EntityManager): Promise<string> {
    if (!customerId) return '';
    const c = await manager.getRepository(Customer).findOne({ where: { id: customerId }, select: { id: true, name: true } });
    return c?.name ?? '';
  }

  private validateAccounts(delivery: SalesDelivery, products: Map<string, Product>, settings: AccountingSetting): void {
    const block = (msg: string): never => {
      throw new BadRequestException(`لا يمكن ترحيل إذن التسليم لأن ${msg}`);
    };
    for (const item of delivery.items) {
      const product = products.get(item.productId);
      if (!product) block('أحد المنتجات غير موجود.');
      if (!product!.trackInventory) block(`المنتج "${product!.name}" ليس صنفاً مخزنياً ولا يمكن تسليمه.`);
      if (!(product!.cogsAccountId ?? settings.costOfGoodsSoldAccountId)) {
        block(missingAccountMessage('cogs', product!.name));
      }
      if (!this.resolveInventoryAccount(product!, settings)) {
        block(missingAccountMessage('inventory', product!.name));
      }
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
  private async lock(manager: EntityManager, id: string): Promise<SalesDelivery> {
    const d = await manager.findOne(SalesDelivery, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!d) throw new NotFoundException('لم يتم العثور على إذن التسليم');
    return d;
  }

  private reload(manager: EntityManager, id: string): Promise<SalesDelivery> {
    return manager.findOne(SalesDelivery, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<SalesDelivery>;
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
    this.assertDateWithin(entryDate, period.startDate, period.endDate, 'تاريخ التسليم خارج نطاق الفترة المحاسبية');
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
  /**
   * A manufacturing line whose production order was cancelled or deleted gets a
   * NEW order for the REMAINING quantity, built from the invoice line exactly like
   * at invoice posting (specs, per-unit BOM, factory, fee pro-rated). Nothing is
   * posted to the supplier until that order is started.
   */
  async recreateManufacturingOrder(
    deliveryId: string,
    itemId: string,
    actorId?: string,
    branchScope: string[] | null = null,
  ): Promise<ManufacturingOrder> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, deliveryId);
      if (!isWithinBranchScope(delivery.branchId, branchScope)) throw new NotFoundException('لم يتم العثور على إذن التسليم');
      const item = delivery.items.find((i) => i.id === itemId);
      if (!item) throw new NotFoundException('السطر غير موجود في إذن التسليم');
      if (item.lineType !== SalesLineType.MANUFACTURING || !item.salesInvoiceItemId || !delivery.salesInvoiceId) {
        throw new BadRequestException('هذا الإجراء لأسطر التصنيع المرتبطة بفاتورة فقط');
      }
      const remaining = round3((item.orderedQuantity ?? 0) - (item.deliveredQuantity ?? 0) - (item.cancelledQuantity ?? 0));
      if (remaining <= 0) throw new BadRequestException('تم تسليم السطر بالكامل — لا حاجة لأمر تصنيع');

      const moRepo = manager.getRepository(ManufacturingOrder);
      const active = await moRepo.findOne({
        where: { salesInvoiceItemId: item.salesInvoiceItemId, status: Not(ManufacturingOrderStatus.CANCELLED) },
      });
      if (active) {
        throw new BadRequestException(`يوجد أمر تصنيع قائم لهذا السطر (${active.orderNumber ?? ''}) — لا حاجة لإنشاء أمر جديد`);
      }

      const invoice = await manager.getRepository(SalesInvoice).findOne({ where: { id: delivery.salesInvoiceId } });
      const line = await manager.getRepository(SalesInvoiceItem).findOne({ where: { id: item.salesInvoiceItemId } });
      if (!invoice || !line) throw new NotFoundException('سطر الفاتورة غير موجود');
      const comps = await manager
        .getRepository(SalesInvoiceItemComponent)
        .find({ where: { salesInvoiceItemId: line.id }, order: { lineNumber: 'ASC' } });
      const customer = await manager.getRepository(Customer).findOne({ where: { id: invoice.customerId } });
      const ordered = Number(line.quantity) || 0;
      const fee = ordered > 0 ? round2(((Number(line.manufacturingFee) || 0) * remaining) / ordered) : 0;

      const order = await this.manufacturingService.createFromInvoiceLine(
        {
          productId: line.productId,
          productName: line.productName,
          quantity: remaining,
          customerId: invoice.customerId,
          customerName: customer?.name ?? null,
          branchId: invoice.branchId,
          fiscalYearId: invoice.fiscalYearId,
          orderDate: todayIso(),
          deliveryDate: line.deliveryDate,
          dimensions: line.dimensions,
          color: line.color,
          material: line.material,
          specifications: line.specifications,
          factorySupplierId: line.factorySupplierId ?? null,
          manufacturingFee: fee,
          sourceType: JournalSourceType.SALES_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoice.invoiceNumber,
          salesInvoiceItemId: line.id,
          accountingPeriodId: invoice.accountingPeriodId,
          components: comps.map((c) => ({ componentProductId: c.componentProductId, quantity: c.quantity, warehouseId: c.warehouseId ?? null })),
          actorId,
        },
        manager,
      );
      item.manufacturingOrderId = order.id;
      await manager.getRepository(SalesDeliveryItem).save(item);
      return order;
    });
  }
  /**
   * CANCEL a manufacturing line the customer no longer wants: its undelivered
   * quantity is credited through a sales return that is created AND posted
   * (reduces revenue + VAT and the customer's balance — see SalesReturnPostingService.post),
   * then the line is closed on the order and hidden from the order and the prints.
   * The posted invoice itself is never edited. Reversing that return re-opens the line.
   */
  async cancelLine(
    deliveryId: string,
    itemId: string,
    input: { returnDate: string; reason?: string | null },
    actorId?: string,
    branchScope: string[] | null = null,
  ): Promise<SalesDelivery> {
    const delivery = await this.dataSource.getRepository(SalesDelivery).findOne({ where: { id: deliveryId }, relations: { items: true } });
    if (!delivery || !isWithinBranchScope(delivery.branchId, branchScope)) throw new NotFoundException('لم يتم العثور على إذن التسليم');
    const item = delivery.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('السطر غير موجود في إذن التسليم');
    if (item.lineType !== SalesLineType.MANUFACTURING || !item.salesInvoiceItemId || !delivery.salesInvoiceId) {
      throw new BadRequestException('إلغاء السطر متاح لأصناف التصنيع المرتبطة بفاتورة فقط');
    }
    const remaining = round3((item.orderedQuantity ?? 0) - (item.deliveredQuantity ?? 0) - (item.cancelledQuantity ?? 0));
    if (remaining <= 0) throw new BadRequestException('لا توجد كمية متبقية لإلغائها');
    if (item.manufacturingOrderId) {
      const mo = await this.dataSource.getRepository(ManufacturingOrder).findOne({ where: { id: item.manufacturingOrderId } });
      if (mo && mo.status !== ManufacturingOrderStatus.CANCELLED) {
        throw new BadRequestException(`أمر التصنيع ${mo.orderNumber ?? ''} ما زال قائماً — ألغِه أو احذفه أولاً قبل إلغاء السطر`);
      }
    }
    const { fiscalYear, period } = await this.resolvePostingContext(input.returnDate, this.dataSource.manager);

    // 1) credit note for the cancelled quantity (draft → post). A failed post
    //    leaves no orphan draft behind.
    const draft = await this.salesReturnService.create(
      {
        salesInvoiceId: delivery.salesInvoiceId,
        returnDate: input.returnDate,
        fiscalYearId: fiscalYear.id,
        accountingPeriodId: period.id,
        notes: `إلغاء صنف «${item.productName ?? ''}» (${remaining}) من إذن التسليم${delivery.invoiceNumber ? ` — فاتورة ${delivery.invoiceNumber}` : ''}${input.reason ? ` — ${input.reason}` : ''}`,
        items: [{ salesInvoiceItemId: item.salesInvoiceItemId, quantity: remaining }],
      } as never,
      actorId,
      branchScope,
    );
    let posted: { id: string };
    try {
      posted = await this.salesReturnPosting.post(draft.id, actorId, branchScope);
    } catch (err) {
      await this.salesReturnService.remove(draft.id, actorId, branchScope).catch(() => undefined);
      throw err;
    }

    // 2) close the line on the order (+ invoice delivery status)
    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lock(manager, deliveryId);
      const line = locked.items.find((i) => i.id === itemId)!;
      line.cancelledQuantity = round3((line.cancelledQuantity ?? 0) + remaining);
      line.cancelReturnId = posted.id;
      await manager.getRepository(SalesDeliveryItem).save(line);
      locked.deliveryProgress = this.computeProgress(locked.items);
      locked.updatedBy = actorId ?? null;
      await manager.getRepository(SalesDelivery).save(locked);
      await this.applyInvoiceLineDelivery(manager, locked.salesInvoiceId!, line.salesInvoiceItemId!, 0);
      return this.reload(manager, deliveryId);
    });
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}
