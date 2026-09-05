import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { SalesDelivery } from './entities/sales-delivery.entity';
import { SalesDeliverySource, SalesDeliveryStatus } from './enums/sales-delivery.enum';
import { ReverseSalesDeliveryDto } from './dto/reverse-sales-delivery.dto';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import {
  SalesDeliveryStatus as InvoiceDeliveryStatus,
  SalesLineType,
} from '../sales-invoice/enums/sales-invoice.enum';
import { Product } from '../product/entities/product.entity';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import { JournalEntryService, JournalLineInput } from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

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
  ) {}

  async post(id: string, actorId?: string, branchScope: string | null = null): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, id);
      if (branchScope && delivery.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      if (delivery.status !== SalesDeliveryStatus.DRAFT) throw new BadRequestException('لا يمكن ترحيل إذن تسليم غير مسودة');
      if (!delivery.items?.length) throw new BadRequestException('لا يمكن ترحيل إذن تسليم بدون أصناف');

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
        warehouseId: i.warehouseId,
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
        allowNegative: true,
      });
      delivery.items.forEach((item, idx) => {
        item.unitCostAtPost = issued[idx].unitCost;
        item.lineCost = round2(item.quantity * issued[idx].unitCost);
      });
      delivery.totalCost = round2(delivery.items.reduce((s, i) => s + i.lineCost, 0));

      // Invoice-linked: release the held reservation and advance delivery progress.
      if (delivery.source === SalesDeliverySource.INVOICE && delivery.salesInvoiceId) {
        await this.stockService.releaseReservation(stockLines, manager);
        await this.applyInvoiceDelivery(manager, delivery, +1);
      }

      // Book the cost of sales: DR COGS / CR inventory.
      const lines = this.buildJournalLines(delivery, products, settings);
      if (lines.length) {
        const journalEntry = await this.journalService.createSystemJournalEntry(
          {
            sourceType: JournalSourceType.SALES_DELIVERY,
            sourceId: delivery.id,
            sourceNumber: number,
            entryDate: delivery.deliveryDate,
            fiscalYearId: delivery.fiscalYearId,
            accountingPeriodId: delivery.accountingPeriodId,
            branchId: delivery.branchId,
            description: `إذن تسليم ${number}${delivery.invoiceNumber ? ` — فاتورة ${delivery.invoiceNumber}` : ''}`,
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

  async reverse(id: string, dto: ReverseSalesDeliveryDto, actorId?: string, branchScope: string | null = null): Promise<SalesDelivery> {
    return this.dataSource.transaction(async (manager) => {
      const delivery = await this.lock(manager, id);
      if (branchScope && delivery.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على إذن التسليم');
      }
      if (delivery.status === SalesDeliveryStatus.REVERSED) throw new ConflictException('إذن التسليم معكوس بالفعل');
      if (delivery.status !== SalesDeliveryStatus.POSTED) throw new BadRequestException('لا يمكن عكس إذن تسليم غير مُرحّل');

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate, 'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      // Receive the goods back at their original issue cost.
      await this.stockService.receive(
        delivery.items.map((i) => ({ warehouseId: i.warehouseId, productId: i.productId, quantity: i.quantity, unitCost: i.unitCostAtPost })),
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
          delivery.items.map((i) => ({ warehouseId: i.warehouseId, productId: i.productId, quantity: i.quantity })),
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

    const stockItems = invoice.items.filter((i) => i.lineType !== SalesLineType.MANUFACTURING);
    const anyDelivered = stockItems.some((i) => (i.deliveredQuantity ?? 0) > 1e-6);
    const allDelivered =
      stockItems.length > 0 && stockItems.every((i) => (i.deliveredQuantity ?? 0) + 1e-6 >= i.quantity);
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
  private buildJournalLines(delivery: SalesDelivery, products: Map<string, Product>, settings: AccountingSetting): JournalLineInput[] {
    const acc = new Map<string, { debit: number; credit: number }>();
    const add = (accountId: string, debit: number, credit: number): void => {
      const e = acc.get(accountId) ?? { debit: 0, credit: 0 };
      e.debit = round2(e.debit + debit);
      e.credit = round2(e.credit + credit);
      acc.set(accountId, e);
    };

    for (const item of delivery.items) {
      if (item.lineCost <= 0) continue;
      const product = products.get(item.productId)!;
      const cogs = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId!;
      const inventory = this.resolveInventoryAccount(product, settings)!;
      add(cogs, item.lineCost, 0);
      add(inventory, 0, item.lineCost);
    }

    return [...acc.entries()]
      .map(([accountId, e]) => {
        const net = round2(e.debit - e.credit);
        return net >= 0 ? { accountId, debit: net, credit: 0 } : { accountId, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
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
        block(`حساب تكلفة المبيعات للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
      }
      if (!this.resolveInventoryAccount(product!, settings)) {
        block(`حساب المخزون للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
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
}
