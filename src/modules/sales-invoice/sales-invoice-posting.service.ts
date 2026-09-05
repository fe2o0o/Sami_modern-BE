import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceItem } from './entities/sales-invoice-item.entity';
import { SalesDeliveryStatus, SalesInvoiceStatus, SalesLineType, SalesPaymentType } from './enums/sales-invoice.enum';
import { ReverseSalesInvoiceDto } from './dto/reverse-sales-invoice.dto';
import { round2 } from './sales-math';
import { Product } from '../product/entities/product.entity';
import { Customer } from '../customer/entities/customer.entity';
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
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

/**
 * Owns the accounting/inventory side-effects of a sales invoice. Posting and
 * reversal each run inside ONE transaction: if any step (stock, subledger,
 * journal) throws, everything rolls back — an invoice is never POSTED with a
 * missing journal or an un-issued stock line. Accounting records are created
 * only through the central {@link JournalEntryService}; this service never
 * inserts journal rows itself.
 */
@Injectable()
export class SalesInvoicePostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly cashSubledger: CashSubledgerService,
    private readonly manufacturingService: ManufacturingService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // POST
  // =========================================================
  async post(id: string, actorId?: string, branchScope: string | null = null): Promise<SalesInvoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(manager, id);
      if (branchScope && invoice.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على فاتورة المبيعات');
      }
      if (invoice.status !== SalesInvoiceStatus.DRAFT) {
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

      // Cash sale with no explicit cash account → fall back to the default cash
      // account from Accounting Settings (so the user never has to pick one).
      if (invoice.paymentType === SalesPaymentType.CASH && !invoice.cashAccountId) {
        invoice.cashAccountId = settings.defaultCashAccountId;
      }

      const products = await this.loadProducts(items.map((i) => i.productId), manager);

      // All account mappings must resolve BEFORE we touch stock.
      this.validateAccounts(invoice, items, products, settings);

      // Mint the invoice number up-front so every side-effect shares it.
      const invoiceNumber = await this.sequenceService.nextDocumentNumber('SI', fiscalYear, manager);

      // STOCK lines are RESERVED (soft-held), not issued — the physical issue and
      // the COGS entry happen later on the delivery note. MANUFACTURING lines are
      // made-to-order: they touch no stock and get a linked production order.
      const stockItems = items.filter(
        (i) => i.lineType !== SalesLineType.MANUFACTURING && products.get(i.productId)?.trackInventory,
      );
      const manufacturingItems = items.filter((i) => i.lineType === SalesLineType.MANUFACTURING);

      if (stockItems.length) {
        const stockLines: StockLineInput[] = stockItems.map((i) => ({
          warehouseId: invoice.warehouseId,
          productId: i.productId,
          productName: i.productName ?? products.get(i.productId)?.name,
          quantity: i.quantity,
        }));
        // Hold the goods against this invoice; delivery releases the hold.
        await this.stockService.reserve(stockLines, manager);
      }

      // Build + post the balanced journal entry via the central engine.
      const lines = this.buildJournalLines(invoice, items, products, settings);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.SALES_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoiceNumber,
          entryDate: invoice.invoiceDate,
          fiscalYearId: invoice.fiscalYearId,
          accountingPeriodId: invoice.accountingPeriodId,
          branchId: invoice.branchId,
          description: `فاتورة مبيعات ${invoiceNumber}`,
          lines,
          actorId,
        },
        manager,
      );

      // Credit sale → customer receivable; cash sale → settled immediately.
      if (invoice.paymentType === SalesPaymentType.CREDIT) {
        await this.customerLedger.record(
          {
            customerId: invoice.customerId,
            transactionDate: invoice.invoiceDate,
            type: CustomerTransactionType.SALES_INVOICE,
            sourceType: JournalSourceType.SALES_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoiceNumber,
            debit: invoice.totalAmount,
            credit: 0,
            description: `فاتورة مبيعات آجلة ${invoiceNumber}`,
            actorId,
          },
          manager,
        );
        invoice.paidAmount = 0;
        invoice.remainingAmount = invoice.totalAmount;
      } else {
        // Cash sale: mirror the cash inflow into the treasury/bank subledger so
        // it appears in the cashbox statement (no extra journal — the entry above
        // already debited the cash account).
        await this.cashSubledger.record(
          {
            cashAccountId: invoice.cashAccountId,
            documentKind: 'sale_invoice',
            amount: invoice.totalAmount,
            transactionDate: invoice.invoiceDate,
            sourceType: JournalSourceType.SALES_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoiceNumber,
            journalEntryId: journalEntry.id,
            description: `فاتورة مبيعات نقدية ${invoiceNumber}`,
            actorId,
          },
          manager,
        );
        invoice.paidAmount = invoice.totalAmount;
        invoice.remainingAmount = 0;
      }

      invoice.invoiceNumber = invoiceNumber;
      invoice.status = SalesInvoiceStatus.POSTED;
      // Stock lines start awaiting delivery; a manufacturing-only invoice never ships.
      invoice.deliveryStatus = stockItems.length
        ? SalesDeliveryStatus.PENDING
        : SalesDeliveryStatus.NOT_APPLICABLE;
      invoice.journalEntryId = journalEntry.id;
      invoice.postedAt = new Date();
      invoice.postedBy = actorId ?? null;
      invoice.updatedBy = actorId ?? null;

      await manager.getRepository(SalesInvoice).save(invoice);

      // For each made-to-order line, create a linked manufacturing (production)
      // order carrying the customer's specification, traceable to this invoice.
      if (manufacturingItems.length) {
        const customer = await manager
          .getRepository(Customer)
          .findOne({ where: { id: invoice.customerId } });
        for (const item of manufacturingItems) {
          await this.manufacturingService.createFromInvoiceLine(
            {
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
              customerId: invoice.customerId,
              customerName: customer?.name ?? null,
              branchId: invoice.branchId,
              fiscalYearId: invoice.fiscalYearId,
              orderDate: invoice.invoiceDate,
              deliveryDate: item.deliveryDate,
              dimensions: item.dimensions,
              color: item.color,
              material: item.material,
              specifications: item.specifications,
              sourceType: JournalSourceType.SALES_INVOICE,
              sourceId: invoice.id,
              sourceNumber: invoiceNumber,
              actorId,
            },
            manager,
          );
        }
      }

      return this.reload(manager, id);
    });
  }

  // =========================================================
  // REVERSE
  // =========================================================
  async reverse(
    id: string,
    dto: ReverseSalesInvoiceDto,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<SalesInvoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(manager, id);
      if (branchScope && invoice.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على فاتورة المبيعات');
      }
      if (invoice.status === SalesInvoiceStatus.REVERSED) {
        throw new ConflictException('الفاتورة معكوسة بالفعل');
      }
      if (invoice.status !== SalesInvoiceStatus.POSTED) {
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

      // Goods were only RESERVED (never issued) at post, so reversal releases the
      // hold rather than receiving stock back. A partially/fully delivered invoice
      // cannot be reversed — its delivery notes must be reversed first.
      const deliveredQty = invoice.items.reduce((s, i) => s + (i.deliveredQuantity ?? 0), 0);
      if (deliveredQty > 0) {
        throw new BadRequestException(
          'لا يمكن عكس فاتورة تم تسليم جزء منها — يجب عكس أذون التسليم المرتبطة بها أولاً',
        );
      }
      const products = await this.loadProducts(invoice.items.map((i) => i.productId), manager);
      const stockLines: StockLineInput[] = invoice.items
        .filter(
          (i) => i.lineType !== SalesLineType.MANUFACTURING && products.get(i.productId)?.trackInventory,
        )
        .map((i) => ({
          warehouseId: invoice.warehouseId,
          productId: i.productId,
          quantity: i.quantity,
        }));
      if (stockLines.length) {
        await this.stockService.releaseReservation(stockLines, manager);
      }

      // Reverse the journal via an opposite POSTED entry.
      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس فاتورة مبيعات',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.SALES_INVOICE,
          sourceId: invoice.id,
          sourceNumber: invoice.invoiceNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: invoice.branchId,
          description: `عكس فاتورة مبيعات ${invoice.invoiceNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      // Reverse the customer receivable.
      if (invoice.paymentType === SalesPaymentType.CREDIT) {
        await this.customerLedger.record(
          {
            customerId: invoice.customerId,
            transactionDate: dto.reversalDate,
            type: CustomerTransactionType.REVERSAL,
            sourceType: JournalSourceType.SALES_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoice.invoiceNumber,
            debit: 0,
            credit: invoice.totalAmount,
            description: `عكس فاتورة مبيعات ${invoice.invoiceNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      } else {
        // Cash sale reversal: pull the cash back OUT of the treasury/bank subledger.
        await this.cashSubledger.record(
          {
            cashAccountId: invoice.cashAccountId,
            documentKind: 'sale_invoice',
            amount: invoice.totalAmount,
            reversal: true,
            transactionDate: dto.reversalDate,
            sourceType: JournalSourceType.SALES_INVOICE,
            sourceId: invoice.id,
            sourceNumber: invoice.invoiceNumber,
            journalEntryId: reversalEntry.id,
            description: `عكس فاتورة مبيعات نقدية ${invoice.invoiceNumber ?? ''}`,
            actorId,
          },
          manager,
        );
      }

      invoice.status = SalesInvoiceStatus.REVERSED;
      invoice.reversedAt = new Date();
      invoice.reversedBy = actorId ?? null;
      invoice.reversalReason = dto.reason;
      invoice.reversalJournalEntryId = reversalEntry.id;
      invoice.remainingAmount = 0;
      invoice.updatedBy = actorId ?? null;

      await manager.getRepository(SalesInvoice).save(invoice);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING
  // =========================================================
  /** Aggregate the invoice into balanced journal lines by account. */
  private buildJournalLines(
    invoice: SalesInvoice,
    items: SalesInvoiceItem[],
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

    // Debit the receivable (credit sale) or cash/bank (cash sale).
    const debitAccount =
      invoice.paymentType === SalesPaymentType.CREDIT
        ? settings.customerControlAccountId!
        : invoice.cashAccountId!;
    add(debitAccount, invoice.totalAmount, 0);

    // Credit revenue (per product's resolved revenue account).
    for (const item of items) {
      const product = products.get(item.productId)!;
      const revenueAccount = product.salesAccountId ?? settings.salesRevenueAccountId!;
      add(revenueAccount, 0, item.netBeforeTax);
    }
    // Credit output VAT.
    if (invoice.vatAmount > 0) {
      add(settings.outputVatAccountId!, 0, invoice.vatAmount);
    }

    // NOTE: COGS + inventory are intentionally NOT booked here. Goods are only
    // reserved at invoice time; the cost of sales is recognised on the delivery
    // note when the stock physically leaves the warehouse.

    // Sales commission: DR commission expense / CR commission payable.
    if (invoice.commissionTotal > 0) {
      add(settings.commissionExpenseAccountId!, invoice.commissionTotal, 0);
      add(settings.commissionPayableAccountId!, 0, invoice.commissionTotal);
    }

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
    invoice: SalesInvoice,
    items: SalesInvoiceItem[],
    products: Map<string, Product>,
    settings: AccountingSetting,
  ): void {
    const block = (msg: string): never => {
      throw new BadRequestException(`لا يمكن ترحيل فاتورة المبيعات لأن ${msg}`);
    };

    if (invoice.paymentType === SalesPaymentType.CREDIT) {
      if (!settings.customerControlAccountId) block('حساب مراقبة العملاء غير محدد في إعدادات المحاسبة.');
    } else if (!invoice.cashAccountId) {
      block('حساب النقدية الافتراضي غير محدد في إعدادات المحاسبة — يرجى ضبطه أو اختيار حساب للبيع النقدي.');
    }

    for (const item of items) {
      const product = products.get(item.productId);
      if (!product) block('أحد المنتجات غير موجود.');
      const revenue = product!.salesAccountId ?? settings.salesRevenueAccountId;
      if (!revenue) block('حساب إيرادات المبيعات غير محدد في إعدادات المحاسبة.');

      // Made-to-order lines never touch inventory/COGS — skip those checks.
      if (item.lineType !== SalesLineType.MANUFACTURING && product!.trackInventory) {
        const cogs = product!.cogsAccountId ?? settings.costOfGoodsSoldAccountId;
        if (!cogs) block('حساب تكلفة البضاعة المباعة غير محدد في إعدادات المحاسبة.');
        if (!this.resolveInventoryAccount(product!, settings)) {
          block(`حساب المخزون للمنتج "${product!.name}" غير محدد في إعدادات المحاسبة.`);
        }
      }
    }

    if (invoice.vatAmount > 0 && !settings.outputVatAccountId) {
      block('حساب ضريبة القيمة المضافة على المبيعات غير محدد في إعدادات المحاسبة.');
    }

    if (invoice.commissionTotal > 0) {
      if (!settings.commissionExpenseAccountId) block('حساب مصروف عمولات المبيعات غير محدد في إعدادات المحاسبة.');
      if (!settings.commissionPayableAccountId) block('حساب عمولات مستحقة للموظفين غير محدد في إعدادات المحاسبة.');
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
  private async lockInvoice(manager: EntityManager, id: string): Promise<SalesInvoice> {
    const invoice = await manager.findOne(SalesInvoice, {
      where: { id },
      relations: { items: true, commissions: true },
      order: { items: { lineNumber: 'ASC' }, commissions: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('لم يتم العثور على فاتورة المبيعات');
    return invoice;
  }

  private reload(manager: EntityManager, id: string): Promise<SalesInvoice> {
    return manager.findOne(SalesInvoice, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<SalesInvoice>;
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
