import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
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

      // Mint the invoice number up-front so every side-effect shares it.
      const invoiceNumber = await this.sequenceService.nextDocumentNumber('PI', fiscalYear, manager);

      // Receive inventory at the net (after-discount, pre-VAT) unit cost.
      const stockLines: StockLineInput[] = items.map((i) => ({
        warehouseId: invoice.warehouseId,
        productId: i.productId,
        productName: i.productName ?? products.get(i.productId)?.name,
        quantity: i.quantity,
        unitCost: this.netUnitCost(i),
      }));
      await this.stockService.receive(stockLines, manager, {
        movementType: StockMovementType.PURCHASE,
        sourceType: JournalSourceType.PURCHASE_INVOICE,
        sourceId: invoice.id,
        sourceNumber: invoiceNumber,
        movementDate: invoice.invoiceDate,
        actorId,
      });
      // Snapshot the net cost each line was received at (for returns / reversal).
      items.forEach((item) => (item.unitCostAtPost = this.netUnitCost(item)));

      // Build + post the balanced journal entry via the central engine.
      const lines = this.buildJournalLines(invoice, items, products, settings);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PURCHASE_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoiceNumber,
          entryDate: invoice.invoiceDate,
          fiscalYearId: invoice.fiscalYearId,
          accountingPeriodId: invoice.accountingPeriodId,
          branchId: invoice.branchId,
          description: `فاتورة مشتريات ${invoiceNumber}`,
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

      // Reverse inventory: issue the received quantities back OUT of the
      // warehouse (allowNegative — a later sale may already have depleted it).
      const stockLines: StockLineInput[] = invoice.items.map((i) => ({
        warehouseId: invoice.warehouseId,
        productId: i.productId,
        productName: i.productName ?? undefined,
        quantity: i.quantity,
      }));
      await this.stockService.issue(stockLines, manager, {
        movementType: StockMovementType.PURCHASE_RETURN,
        sourceType: JournalSourceType.PURCHASE_INVOICE,
        sourceId: invoice.id,
        sourceNumber: invoice.invoiceNumber,
        movementDate: dto.reversalDate,
        actorId,
        allowNegative: true,
      });

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
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING
  // =========================================================
  /** Net (after-discount, pre-VAT) unit cost a line is capitalized into stock at. */
  private netUnitCost(item: PurchaseInvoiceItem): number {
    const qty = item.quantity || 0;
    return qty > 0 ? round2(item.netBeforeTax / qty) : 0;
  }

  /** Aggregate the invoice into balanced journal lines by account. */
  private buildJournalLines(
    invoice: PurchaseInvoice,
    items: PurchaseInvoiceItem[],
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

    // Debit inventory (per product's resolved inventory account) at net cost.
    for (const item of items) {
      const product = products.get(item.productId)!;
      const inventoryAccount = this.resolveInventoryAccount(product, settings)!;
      add(inventoryAccount, item.netBeforeTax, 0);
    }
    // Debit recoverable input VAT.
    if (invoice.vatAmount > 0) {
      add(settings.inputVatAccountId!, invoice.vatAmount, 0);
    }

    // Credit the payable (credit purchase) or cash/bank (cash purchase).
    const creditAccount =
      invoice.paymentType === PurchasePaymentType.CREDIT
        ? settings.supplierControlAccountId!
        : invoice.cashAccountId!;
    add(creditAccount, 0, invoice.totalAmount);

    return [...acc.entries()]
      .map(([accountId, e]) => {
        const net = round2(e.debit - e.credit);
        return net >= 0
          ? { accountId, debit: net, credit: 0 }
          : { accountId, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
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
        block(`حساب المخزون للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
      }
    }

    if (invoice.vatAmount > 0 && !settings.inputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المشتريات غير محدد في إعدادات المحاسبة.');
    }
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
