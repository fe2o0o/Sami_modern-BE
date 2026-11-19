import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';
import { isWithinBranchScope } from "../../common/utils/branch-scope.util";
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from './entities/purchase-invoice-item.entity';
import {
  PurchaseInvoiceStatus,
  PurchasePaymentType,
} from './enums/purchase-invoice.enum';
import { ReversePurchaseInvoiceDto } from './dto/reverse-purchase-invoice.dto';
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
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { MANUFACTURING_ORDER_STATUS_LABELS, ManufacturingOrderStatus } from '../manufacturing/enums/manufacturing.enum';
import { DIRECT_MATERIAL_OPEN_STATUSES, DIRECT_MATERIAL_TYPES } from '../manufacturing/direct-material.util';
import { ManufacturingProductionService } from '../manufacturing/manufacturing-production.service';

/** Where a line bought straight onto a manufacturing order is debited: the order's product cost account. */
interface DirectTarget { accountId: string; order: ManufacturingOrder }

/**
 * Owns the accounting/inventory side-effects of a purchase invoice. Posting and
 * reversal each run inside ONE transaction: if any step (stock, subledger,
 * journal) throws, everything rolls back — an invoice is never POSTED with a
 * missing journal or an un-received stock line. Accounting records are created
 * only through the central {@link JournalEntryService}; this service never
 * inserts journal rows itself.
 */
@Injectable()
export class PurchaseInvoicePostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly cashSubledger: CashSubledgerService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
    private readonly manufacturing: ManufacturingProductionService,
  ) {}

  // =========================================================
  // POST
  // =========================================================
  async post(id: string, actorId?: string, branchScope: string[] | null = null): Promise<PurchaseInvoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(manager, id);
      if (!isWithinBranchScope(invoice.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على فاتورة المشتريات');
      }
      if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
        throw new BadRequestException('لا يمكن ترحيل فاتورة غير مسودة');
      }
      const items = invoice.items ?? [];
      if (!items.length) {
        throw new BadRequestException('لا يمكن ترحيل فاتورة بدون أصناف');
      }

      const { fiscalYear } = await this.assertOpenPostingContext(
        invoice.fiscalYearId,
        invoice.accountingPeriodId,
        invoice.invoiceDate,
        manager,
      );

      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');

      // Cash purchase with no explicit cash account → fall back to the default
      // cash account from Accounting Settings (so the user never has to pick one).
      if (invoice.paymentType === PurchasePaymentType.CASH && !invoice.cashAccountId) {
        invoice.cashAccountId = settings.defaultCashAccountId;
      }

      const products = await this.loadProducts(items.map((i) => i.productId), manager);

      // All account mappings must resolve BEFORE we touch stock.
      this.validateAccounts(invoice, items, products, settings);
      // Lines bought straight onto a manufacturing order: re-checked now (the order may
      // have been produced since the draft was saved) and routed to its product cost account.
      const direct = await this.resolveDirectTargets(items, products, settings, manager);

      // Mint the invoice number up-front so every side-effect shares it.
      const invoiceNumber = await this.sequenceService.nextDocumentNumber('PI', fiscalYear, manager);

      // Receive inventory at the net (after-discount, pre-VAT) unit cost — every line
      // except those bought straight onto a manufacturing order (they never enter stock).
      const stockLines: StockLineInput[] = items.filter((i) => !direct.has(i.id)).map((i) => ({
        warehouseId: invoice.warehouseId,
        productId: i.productId,
        productName: i.productName ?? products.get(i.productId)?.name,
        quantity: i.quantity,
        unitCost: this.netUnitCost(i),
      }));
      if (stockLines.length) {
        await this.stockService.receive(stockLines, manager, {
          movementType: StockMovementType.PURCHASE,
          sourceType: JournalSourceType.PURCHASE_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoiceNumber,
          movementDate: invoice.invoiceDate,
          actorId,
        });
      }
      // Snapshot the net cost each line was received at (for returns / reversal).
      items.forEach((item) => (item.unitCostAtPost = this.netUnitCost(item)));

      // Build + post the balanced journal entry via the central engine. The
      // narration names the supplier so the ledger reads without opening the invoice.
      const supplier = await manager.getRepository(Supplier).findOne({ where: { id: invoice.supplierId }, select: { id: true, name: true } });
      const supplierName = supplier?.name ?? '';
      const paymentLabel = invoice.paymentType === PurchasePaymentType.CREDIT ? 'آجلة' : 'نقدية';
      const lines = this.buildJournalLines(invoice, items, products, settings, invoiceNumber, supplierName, direct);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoiceNumber,
          entryDate: invoice.invoiceDate,
          fiscalYearId: invoice.fiscalYearId,
          accountingPeriodId: invoice.accountingPeriodId,
          branchId: invoice.branchId,
          description: `فاتورة مشتريات ${paymentLabel} ${invoiceNumber} — المورد: ${supplierName}`,
          lines,
          actorId,
        },
        manager,
      );

      // Credit purchase → supplier payable; cash purchase → settled immediately.
      if (invoice.paymentType === PurchasePaymentType.CREDIT) {
        await this.supplierLedger.record(
          {
            supplierId: invoice.supplierId,
            transactionDate: invoice.invoiceDate,
            type: SupplierTransactionType.PURCHASE_INVOICE,
            sourceType: JournalSourceType.PURCHASE_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoiceNumber,
            debit: 0,
            credit: invoice.totalAmount,
            description: `فاتورة مشتريات آجلة ${invoiceNumber}`,
            actorId,
          },
          manager,
        );
        invoice.paidAmount = 0;
        invoice.remainingAmount = invoice.totalAmount;
      } else {
        // Cash purchase: mirror the cash outflow into the treasury/bank subledger
        // (no extra journal — the entry above already credited the cash account).
        await this.cashSubledger.record(
          {
            cashAccountId: invoice.cashAccountId,
            documentKind: 'purchase_invoice',
            amount: invoice.totalAmount,
            transactionDate: invoice.invoiceDate,
            sourceType: JournalSourceType.PURCHASE_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoiceNumber,
            journalEntryId: journalEntry.id,
            description: `فاتورة مشتريات نقدية ${invoiceNumber}`,
            actorId,
          },
          manager,
        );
        invoice.paidAmount = invoice.totalAmount;
        invoice.remainingAmount = 0;
      }

      invoice.invoiceNumber = invoiceNumber;
      invoice.status = PurchaseInvoiceStatus.POSTED;
      invoice.journalEntryId = journalEntry.id;
      invoice.postedAt = new Date();
      invoice.postedBy = actorId ?? null;
      invoice.updatedBy = actorId ?? null;

      await manager.getRepository(PurchaseInvoice).save(invoice);
      // The last purchase price becomes the product's cost (card).
      await this.refreshLastPurchaseCost((invoice.items ?? []).map((i) => i.productId), manager);
      // The orders now carry this material in their cost (and their sales-invoice estimate).
      for (const orderId of new Set([...direct.values()].map((t) => t.order.id))) {
        await this.manufacturing.refreshDirectMaterialWithin(orderId, manager, { date: invoice.invoiceDate, actorId });
      }
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // REVERSE
  // =========================================================
  async reverse(
    id: string,
    dto: ReversePurchaseInvoiceDto,
    actorId?: string,
    branchScope: string[] | null = null,
  ): Promise<PurchaseInvoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(manager, id);
      if (!isWithinBranchScope(invoice.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على فاتورة المشتريات');
      }
      if (invoice.status === PurchaseInvoiceStatus.REVERSED) {
        throw new ConflictException('الفاتورة معكوسة بالفعل');
      }
      if (invoice.status !== PurchaseInvoiceStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس فاتورة غير مُرحّلة');
      }

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(
        dto.reversalDate,
        period.startDate,
        period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة',
      );

      const original = invoice.journalEntryId
        ? await this.journalService.findWithLines(invoice.journalEntryId)
        : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للفاتورة');

      // Lines bought straight onto a manufacturing order: only while the order is unproduced
      // (its cost then simply leaves the order); never once the material went into a warehouse.
      const directOrderIds = await this.assertDirectLinesReversible(invoice.items, manager, 'عكس الفاتورة');

      // Reverse inventory: issue the received quantities back OUT of the
      // warehouse (allowNegative — a later sale may already have depleted it).
      const stockLines: StockLineInput[] = invoice.items.filter((i) => !i.manufacturingOrderId).map((i) => ({
        warehouseId: invoice.warehouseId,
        productId: i.productId,
        productName: i.productName ?? undefined,
        quantity: i.quantity,
      }));
      if (stockLines.length) {
        await this.stockService.issue(stockLines, manager, {
          movementType: StockMovementType.PURCHASE_RETURN,
          sourceType: JournalSourceType.PURCHASE_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoice.invoiceNumber,
          movementDate: dto.reversalDate,
          actorId,
          allowNegative: true,
        });
      }

      // Reverse the journal via an opposite POSTED entry.
      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس فاتورة مشتريات',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoice.invoiceNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: invoice.branchId,
          description: `عكس فاتورة مشتريات ${invoice.invoiceNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      // Reverse the supplier payable.
      if (invoice.paymentType === PurchasePaymentType.CREDIT) {
        await this.supplierLedger.record(
          {
            supplierId: invoice.supplierId,
            transactionDate: dto.reversalDate,
            type: SupplierTransactionType.REVERSAL,
            sourceType: JournalSourceType.PURCHASE_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoice.invoiceNumber,
            debit: invoice.totalAmount,
            credit: 0,
            description: `عكس فاتورة مشتريات ${invoice.invoiceNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash purchase reversal: put the cash back INTO the treasury/bank subledger.
        await this.cashSubledger.record(
          {
            cashAccountId: invoice.cashAccountId,
            documentKind: 'purchase_invoice',
            amount: invoice.totalAmount,
            reversal: true,
            transactionDate: dto.reversalDate,
            sourceType: JournalSourceType.PURCHASE_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoice.invoiceNumber,
            journalEntryId: reversalEntry.id,
            description: `عكس فاتورة مشتريات نقدية ${invoice.invoiceNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      }

      invoice.status = PurchaseInvoiceStatus.REVERSED;
      invoice.reversedAt = new Date();
      invoice.reversedBy = actorId ?? null;
      invoice.reversalReason = dto.reason;
      invoice.reversalJournalEntryId = reversalEntry.id;
      invoice.remainingAmount = 0;
      invoice.updatedBy = actorId ?? null;

      await manager.getRepository(PurchaseInvoice).save(invoice);
      // Back to the latest purchase price still standing (unchanged when none is left).
      await this.refreshLastPurchaseCost((invoice.items ?? []).map((i) => i.productId), manager);
      // The material's cost leaves its orders (and their sales-invoice estimate).
      for (const orderId of directOrderIds) {
        await this.manufacturing.refreshDirectMaterialWithin(orderId, manager, { date: dto.reversalDate, actorId });
      }
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING
  // =========================================================
  /**
   * Product cost = its LAST purchase price: the net (after discount, before VAT)
   * unit price on the latest POSTED purchase invoice, by invoice date. Recomputed
   * after posting and after reversing, so an older-dated invoice never overrides a
   * newer price and a reversed one hands the cost back to the previous purchase.
   * With no posted purchase left the card keeps its cost (never set to 0).
   */
  private async refreshLastPurchaseCost(productIds: string[], manager: EntityManager): Promise<void> {
    const ids = [...new Set(productIds.filter(Boolean))];
    for (const productId of ids) {
      const rows = (await manager.query(
        `SELECT i.net_before_tax AS net, i.quantity AS qty
           FROM purchase_invoice_items i
           JOIN purchase_invoices pi ON pi.id = i.purchase_invoice_id
          WHERE i.product_id = ? AND pi.status = ? AND pi.deleted_at IS NULL AND i.deleted_at IS NULL AND i.quantity > 0
          ORDER BY pi.invoice_date DESC, pi.posted_at DESC, pi.updated_at DESC, i.line_number DESC
          LIMIT 1`,
        [productId, PurchaseInvoiceStatus.POSTED],
      )) as Array<{ net: string; qty: string }>;
      if (!rows.length) continue;
      const unit = round2(Number(rows[0].net) / Number(rows[0].qty));
      if (unit > 0) await manager.getRepository(Product).update({ id: productId, productType: Not(ProductType.SERVICE) }, { costPrice: unit });
    }
  }

  /** Net (after-discount, pre-VAT) unit cost a line is capitalized into stock at. */
  private netUnitCost(item: PurchaseInvoiceItem): number {
    const qty = item.quantity || 0;
    return qty > 0 ? round2(item.netBeforeTax / qty) : 0;
  }

  /** Aggregate the invoice into balanced, narrated journal lines by account. */
  private buildJournalLines(
    invoice: PurchaseInvoice,
    items: PurchaseInvoiceItem[],
    products: Map<string, Product>,
    settings: AccountingSetting,
    invoiceNumber: string,
    supplierName: string,
    direct: Map<string, DirectTarget> = new Map(),
  ): JournalLineInput[] {
    const b = new JournalLineBuilder();
    const ref = `فاتورة مشتريات ${invoiceNumber}`;

    // Debit inventory (per product's resolved inventory account) at net cost — or, for a
    // line bought straight onto a manufacturing order, that order's product cost account.
    for (const item of items) {
      const target = direct.get(item.id);
      if (target) {
        const what = `${item.productName ?? ''}${item.directDescription ? ' — ' + item.directDescription : ''}`;
        b.add(target.accountId, item.netBeforeTax, 0, `خامة مباشرة «${what}» على أمر تصنيع ${target.order.orderNumber ?? ''} (${target.order.productName ?? ''}) — ${ref}`, { productId: target.order.productId });
        continue;
      }
      const product = products.get(item.productId)!;
      const inventoryAccount = this.resolveInventoryAccount(product, settings)!;
      b.add(inventoryAccount, item.netBeforeTax, 0, `استلام بضاعة في المخزن — ${ref}`, { warehouseId: invoice.warehouseId });
    }
    // Debit recoverable input VAT.
    if (invoice.vatAmount > 0) {
      b.add(settings.inputVatAccountId!, invoice.vatAmount, 0, `ضريبة القيمة المضافة (مدخلات) — ${ref}`);
    }

    // Credit the payable (credit purchase, tagged with the supplier) or cash/bank (cash purchase).
    if (invoice.paymentType === PurchasePaymentType.CREDIT) {
      b.add(settings.supplierControlAccountId!, 0, invoice.totalAmount, `مستحق للمورد ${supplierName} — ${ref}`, { supplierId: invoice.supplierId });
    } else {
      b.add(invoice.cashAccountId!, 0, invoice.totalAmount, `سداد نقدي — ${ref} — المورد: ${supplierName}`);
    }

    return b.build();
  }

  /** Validate every account the posting needs is configured. Arabic messages. */
  private validateAccounts(
    invoice: PurchaseInvoice,
    items: PurchaseInvoiceItem[],
    products: Map<string, Product>,
    settings: AccountingSetting,
  ): void {
    const block = (msg: string): never => {
      throw new BadRequestException(`لا يمكن ترحيل فاتورة المشتريات لأن ${msg}`);
    };

    if (invoice.paymentType === PurchasePaymentType.CREDIT) {
      if (!settings.supplierControlAccountId) block('حساب مراقبة الموردين غير محدد في إعدادات المحاسبة.');
    } else if (!invoice.cashAccountId) {
      block('حساب النقدية الافتراضي غير محدد في إعدادات المحاسبة — يرجى ضبطه أو اختيار حساب للشراء النقدي.');
    }

    for (const item of items) {
      const product = products.get(item.productId);
      if (!product) block('أحد المنتجات غير موجود.');
      if (!product!.trackInventory) {
        block(`المنتج "${product!.name}" ليس صنفاً مخزنياً ولا يمكن شراؤه في فاتورة مشتريات.`);
      }
      if (!this.resolveInventoryAccount(product!, settings)) {
        block(missingAccountMessage('inventory', product!.name));
      }
    }

    if (invoice.vatAmount > 0 && !settings.inputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المشتريات غير محدد في إعدادات المحاسبة.');
    }
  }

  /**
   * Lines bought straight onto a manufacturing order → the account they are debited to
   * (the order's product cost account, like the fee booked at «بدء التنفيذ»). Locks the
   * orders and refuses any that is no longer open or a product that is not a raw material.
   */
  private async resolveDirectTargets(
    items: PurchaseInvoiceItem[],
    products: Map<string, Product>,
    settings: AccountingSetting,
    manager: EntityManager,
  ): Promise<Map<string, DirectTarget>> {
    const out = new Map<string, DirectTarget>();
    const linked = items.filter((i) => i.manufacturingOrderId);
    if (!linked.length) return out;
    const ids = [...new Set(linked.map((i) => i.manufacturingOrderId!))];
    const orders = await manager.find(ManufacturingOrder, { where: { id: In(ids) }, lock: { mode: 'pessimistic_write' } });
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const orderProducts = await manager.getRepository(Product).find({ where: { id: In(orders.map((o) => o.productId)) }, withDeleted: true });
    await applyEffectiveAccounts(orderProducts, manager);
    const productById = new Map(orderProducts.map((p) => [p.id, p]));
    for (const item of linked) {
      const product = products.get(item.productId);
      if (!product || !DIRECT_MATERIAL_TYPES.includes(product.productType)) {
        throw new BadRequestException(`«${item.productName ?? ''}» ليس مادة خام أو نصف مصنّع — الشراء المباشر على أمر تصنيع للخامات فقط`);
      }
      const order = orderById.get(item.manufacturingOrderId!);
      if (!order) throw new BadRequestException(`أمر التصنيع المرتبط بالصنف «${item.productName ?? ''}» غير موجود`);
      if (!DIRECT_MATERIAL_OPEN_STATUSES.includes(order.status)) {
        throw new BadRequestException(
          `أمر التصنيع ${order.orderNumber ?? ''} ${MANUFACTURING_ORDER_STATUS_LABELS[order.status as ManufacturingOrderStatus] ?? order.status} — الشراء المباشر على الأمر قبل تنفيذ الإنتاج فقط`,
        );
      }
      const accountId = productById.get(order.productId)?.inventoryAccountId ?? settings.finishedGoodsInventoryAccountId;
      if (!accountId) throw new BadRequestException(missingAccountMessage('inventory', order.productName ?? ''));
      out.set(item.id, { accountId, order });
    }
    return out;
  }

  /**
   * Reversing (or returning) lines bought straight onto an order: allowed only while the
   * order is unproduced and the material never moved into a warehouse. Returns the orders.
   */
  private async assertDirectLinesReversible(items: PurchaseInvoiceItem[], manager: EntityManager, action: string): Promise<string[]> {
    const linked = items.filter((i) => i.manufacturingOrderId);
    if (!linked.length) return [];
    const released = linked.find((i) => i.releasedAt);
    if (released) {
      throw new BadRequestException(
        `الخامة «${released.productName ?? ''}» انتقلت للمخزن بعد إلغاء أمر التصنيع — لا يمكن ${action}؛ استخدم مردود المشتريات`,
      );
    }
    const ids = [...new Set(linked.map((i) => i.manufacturingOrderId!))];
    const orders = await manager.find(ManufacturingOrder, { where: { id: In(ids) }, lock: { mode: 'pessimistic_write' } });
    for (const o of orders) {
      if (!DIRECT_MATERIAL_OPEN_STATUSES.includes(o.status)) {
        throw new BadRequestException(
          `أمر التصنيع ${o.orderNumber ?? ''} ${MANUFACTURING_ORDER_STATUS_LABELS[o.status as ManufacturingOrderStatus] ?? o.status} وعليه خامات من هذه الفاتورة — لا يمكن ${action}`,
        );
      }
    }
    return ids;
  }

  private resolveInventoryAccount(
    product: Product,
    settings: AccountingSetting,
  ): string | null {
    if (product.inventoryAccountId) return product.inventoryAccountId;
    return product.productType === ProductType.RAW_MATERIAL
      ? settings.rawMaterialInventoryAccountId
      : settings.finishedGoodsInventoryAccountId;
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async lockInvoice(manager: EntityManager, id: string): Promise<PurchaseInvoice> {
    const invoice = await manager.findOne(PurchaseInvoice, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('لم يتم العثور على فاتورة المشتريات');
    return invoice;
  }

  private reload(manager: EntityManager, id: string): Promise<PurchaseInvoice> {
    return manager.findOne(PurchaseInvoice, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<PurchaseInvoice>;
  }

  private async loadProducts(
    ids: string[],
    manager: EntityManager,
  ): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await manager.getRepository(Product).find({ where: { id: In(unique) } })
      : [];
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
    if (period.fiscalYearId !== fiscalYear.id) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
    if (period.isClosed) throw new BadRequestException('لا يمكن الترحيل إلى فترة محاسبية مغلقة');
    this.assertDateWithin(entryDate, period.startDate, period.endDate, 'تاريخ الفاتورة خارج نطاق الفترة المحاسبية');
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
    if (d < new Date(start).getTime() || d > new Date(end).getTime()) {
      throw new BadRequestException(message);
    }
  }
}
