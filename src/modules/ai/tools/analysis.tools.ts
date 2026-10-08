import { Injectable } from '@nestjs/common';
import { CustomerService } from '../../customer/customer.service';
import { SupplierService } from '../../supplier/supplier.service';
import { PartySummaryQueryDto } from '../../../common/dto/party-summary-query.dto';
import { SalesInvoiceService } from '../../sales-invoice/sales-invoice.service';
import { SalesInvoiceQueryDto } from '../../sales-invoice/dto/sales-invoice-query.dto';
import { SalesInvoiceStatus } from '../../sales-invoice/enums/sales-invoice.enum';
import { PurchaseInvoiceService } from '../../purchase-invoice/purchase-invoice.service';
import { PurchaseInvoiceQueryDto } from '../../purchase-invoice/dto/purchase-invoice-query.dto';
import { PurchaseInvoiceStatus } from '../../purchase-invoice/enums/purchase-invoice.enum';
import { SalesReturnService } from '../../sales-return/sales-return.service';
import { SalesReturnQueryDto } from '../../sales-return/dto/sales-return-query.dto';
import { SalesReturnStatus } from '../../sales-return/enums/sales-return.enum';
import { PurchaseReturnService } from '../../purchase-return/purchase-return.service';
import { PurchaseReturnQueryDto } from '../../purchase-return/dto/purchase-return-query.dto';
import { PurchaseReturnStatus } from '../../purchase-return/enums/purchase-return.enum';
import { VoucherService } from '../../voucher/voucher.service';
import { VoucherQueryDto } from '../../voucher/dto/voucher-query.dto';
import { VoucherPaymentMethod, VoucherStatus, VoucherType } from '../../voucher/enums/voucher.enum';
import { JournalEntryService } from '../../journal-entry/journal-entry.service';
import { JournalEntryQueryDto } from '../../journal-entry/dto/journal-entry-query.dto';
import { JournalEntryStatus, JournalSourceType } from '../../journal-entry/enums/journal-entry.enum';
import { ProductService } from '../../product/product.service';
import { QueryProductDto } from '../../product/dto/query-product.dto';
import { ProductType } from '../../product/enums/product-type.enum';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, normalizeDate, optBool, optEnum, optStr, optUuid } from './tool-helpers';

const id = (desc: string) => ({ type: 'string', description: `${desc} (uuid)` });
const period = {
  dateFrom: dateProp('بداية الفترة'),
  dateTo: dateProp('نهاية الفترة'),
};

/**
 * Analysis summaries (the cards above each list screen) — every tool calls the
 * list's own `summary()` with the same filters, so numbers match the screens.
 * Permissions mirror each controller's `GET …/summary` route.
 */
@Injectable()
export class AnalysisAiTools {
  constructor(
    private readonly customers: CustomerService,
    private readonly suppliers: SupplierService,
    private readonly salesInvoices: SalesInvoiceService,
    private readonly purchaseInvoices: PurchaseInvoiceService,
    private readonly salesReturns: SalesReturnService,
    private readonly purchaseReturns: PurchaseReturnService,
    private readonly vouchers: VoucherService,
    private readonly journal: JournalEntryService,
    private readonly products: ProductService,
  ) {}

  private party(args: Record<string, unknown>): PartySummaryQueryDto {
    return {
      search: optStr(args.search),
      isActive: optBool(args.isActive),
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
    } as PartySummaryQueryDto;
  }

  private partyProps(who: string): Record<string, unknown> {
    return {
      search: { type: 'string', description: `اسم/كود ${who}` },
      isActive: { type: 'boolean', description: 'true = النشطون فقط / false = غير النشطين' },
      dateFrom: dateProp('بداية فترة الحركة'),
      dateTo: dateProp('نهاية فترة الحركة'),
    };
  }

  defs(): AiToolDefinition[] {
    const siStatuses = Object.values(SalesInvoiceStatus);
    const piStatuses = Object.values(PurchaseInvoiceStatus);
    const srStatuses = Object.values(SalesReturnStatus);
    const prStatuses = Object.values(PurchaseReturnStatus);
    const vStatuses = Object.values(VoucherStatus);
    const jeStatuses = Object.values(JournalEntryStatus);
    return [
      {
        name: 'get_customers_summary',
        description:
          'تحليل العملاء ككل: عدد العملاء والنشطين ومن عليهم رصيد، إجمالي المستحق على العملاء (outstanding) والدفعات المقدمة منهم (advances) وصافي الرصيد، عدد من تجاوزوا حد الائتمان، وحركة مدين/دائن خلال فترة اختيارية.',
        permission: 'customers.view',
        parameters: { type: 'object', properties: this.partyProps('العميل'), additionalProperties: false },
        handler: async (args) => {
          const data = await this.customers.summary(this.party(args));
          return { success: true, presentation: 'report', data: { title: 'ملخص العملاء', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_suppliers_summary',
        description:
          'تحليل الموردين ككل: عدد الموردين والنشطين ومن لهم رصيد، إجمالي المستحق للموردين (outstanding) والدفعات المقدمة لهم (advances) وصافي الرصيد، وحركة مدين/دائن خلال فترة اختيارية.',
        permission: 'suppliers.view',
        parameters: { type: 'object', properties: this.partyProps('المورد'), additionalProperties: false },
        handler: async (args) => {
          const data = await this.suppliers.summary(this.party(args));
          return { success: true, presentation: 'report', data: { title: 'ملخص الموردين', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_sales_invoices_summary',
        description:
          'ملخص فواتير المبيعات بنفس فلاتر القائمة (فترة/عميل/حالة/مخزن/فرع/بحث): العدد حسب الحالة، عدد غير المسدّدة، الإجمالي قبل/بعد الضريبة، المحصّل والمتبقي ومتوسط الفاتورة. المبالغ على الفواتير المُرحّلة ما لم تُحدَّد حالة.',
        permission: 'sales_invoices.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            customerId: id('معرّف العميل'),
            status: { type: 'string', enum: siStatuses },
            warehouseId: id('معرّف المخزن'),
            branchId: id('معرّف الفرع'),
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم الفاتورة' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            customerId: optUuid(args.customerId, 'customerId'),
            status: optEnum(args.status, siStatuses, 'status'),
            warehouseId: optUuid(args.warehouseId, 'warehouseId'),
            branchId: optUuid(args.branchId, 'branchId'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as SalesInvoiceQueryDto;
          const data = await this.salesInvoices.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص فواتير المبيعات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_purchase_invoices_summary',
        description:
          'ملخص فواتير المشتريات بنفس فلاتر القائمة (فترة/مورد/حالة/مخزن/فرع/بحث): العدد حسب الحالة، عدد غير المسدّدة، الإجمالي قبل/بعد الضريبة، المدفوع والمتبقي ومتوسط الفاتورة. المبالغ على الفواتير المُرحّلة ما لم تُحدَّد حالة.',
        permission: 'purchase_invoices.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            supplierId: id('معرّف المورد'),
            status: { type: 'string', enum: piStatuses },
            warehouseId: id('معرّف المخزن'),
            branchId: id('معرّف الفرع'),
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم الفاتورة' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            supplierId: optUuid(args.supplierId, 'supplierId'),
            status: optEnum(args.status, piStatuses, 'status'),
            warehouseId: optUuid(args.warehouseId, 'warehouseId'),
            branchId: optUuid(args.branchId, 'branchId'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as PurchaseInvoiceQueryDto;
          const data = await this.purchaseInvoices.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص فواتير المشتريات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_sales_returns_summary',
        description:
          'ملخص مردودات المبيعات بنفس فلاتر القائمة (فترة/عميل/فاتورة/حالة): العدد حسب الحالة، إجمالي المرتجعات قبل/بعد الضريبة، تكلفة البضاعة المرتجعة ومتوسط المرتجع.',
        permission: 'sales_returns.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            customerId: id('معرّف العميل'),
            salesInvoiceId: id('معرّف فاتورة المبيعات'),
            status: { type: 'string', enum: srStatuses },
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم المرتجع' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            customerId: optUuid(args.customerId, 'customerId'),
            salesInvoiceId: optUuid(args.salesInvoiceId, 'salesInvoiceId'),
            status: optEnum(args.status, srStatuses, 'status'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as SalesReturnQueryDto;
          const data = await this.salesReturns.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص مردودات المبيعات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_purchase_returns_summary',
        description: 'ملخص مردودات المشتريات بنفس فلاتر القائمة (فترة/مورد/فاتورة/حالة): العدد حسب الحالة، الإجمالي قبل/بعد الضريبة ومتوسط المرتجع.',
        permission: 'purchase_returns.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            supplierId: id('معرّف المورد'),
            purchaseInvoiceId: id('معرّف فاتورة المشتريات'),
            status: { type: 'string', enum: prStatuses },
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم المرتجع' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            supplierId: optUuid(args.supplierId, 'supplierId'),
            purchaseInvoiceId: optUuid(args.purchaseInvoiceId, 'purchaseInvoiceId'),
            status: optEnum(args.status, prStatuses, 'status'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as PurchaseReturnQueryDto;
          const data = await this.purchaseReturns.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص مردودات المشتريات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_vouchers_summary',
        description:
          'ملخص سندات القبض والصرف بنفس فلاتر القائمة: عدد السندات حسب الحالة والنوع، إجمالي المقبوضات والمدفوعات والصافي، مفصّلة على الخزائن والبنوك. المبالغ على المُرحّل ما لم تُحدَّد حالة.',
        permission: 'vouchers.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            type: { type: 'string', enum: Object.values(VoucherType), description: 'receipt (قبض) / payment (صرف)' },
            partyId: id('معرّف العميل/المورد'),
            paymentMethod: { type: 'string', enum: Object.values(VoucherPaymentMethod), description: 'treasury (خزينة) / bank (بنك)' },
            status: { type: 'string', enum: vStatuses },
            branchId: id('معرّف الفرع'),
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم السند' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            type: optEnum(args.type, Object.values(VoucherType), 'type'),
            partyId: optUuid(args.partyId, 'partyId'),
            paymentMethod: optEnum(args.paymentMethod, Object.values(VoucherPaymentMethod), 'paymentMethod'),
            status: optEnum(args.status, vStatuses, 'status'),
            branchId: optUuid(args.branchId, 'branchId'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as VoucherQueryDto;
          const data = await this.vouchers.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص السندات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_journal_entries_summary',
        description:
          'ملخص القيود المحاسبية بنفس فلاتر القائمة: العدد حسب الحالة، اليدوية مقابل الآلية، إجمالي المدين/الدائن (والمسودات)، وتوزيع القيود حسب المصدر (فواتير/سندات/تسليم/تصنيع…).',
        permission: 'journal_entries.view',
        parameters: {
          type: 'object',
          properties: {
            ...period,
            status: { type: 'string', enum: jeStatuses },
            sourceType: { type: 'string', enum: Object.values(JournalSourceType), description: 'مصدر القيد' },
            branchId: id('معرّف الفرع'),
            fiscalYearId: id('معرّف السنة المالية'),
            search: { type: 'string', description: 'رقم القيد أو البيان' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            status: optEnum(args.status, jeStatuses, 'status'),
            sourceType: optEnum(args.sourceType, Object.values(JournalSourceType), 'sourceType'),
            branchId: optUuid(args.branchId, 'branchId'),
            fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
            search: optStr(args.search),
          } as JournalEntryQueryDto;
          const data = await this.journal.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص القيود', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_products_summary',
        description:
          'ملخص المنتجات بنفس فلاتر قائمة المنتجات (تصنيف/علامة/نوع/نشط/بحث): عدد المنتجات والنشطة، التوزيع حسب النوع (تام/خام/نصف مصنّع/خدمة)، المخزنية والمصنّعة، عدد الأصناف الموجودة بالمخزون وإجمالي الكمية والقيمة.',
        permission: 'products.view',
        parameters: {
          type: 'object',
          properties: {
            categoryId: id('معرّف التصنيف'),
            brandId: id('معرّف العلامة التجارية'),
            productType: { type: 'string', enum: Object.values(ProductType), description: 'finished_product / raw_material / semi_finished / service' },
            isActive: { type: 'boolean' },
            search: { type: 'string', description: 'كود/اسم/باركود المنتج' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            categoryId: optUuid(args.categoryId, 'categoryId'),
            brandId: optUuid(args.brandId, 'brandId'),
            productType: optEnum(args.productType, Object.values(ProductType), 'productType'),
            isActive: optBool(args.isActive),
            search: optStr(args.search),
          } as QueryProductDto;
          const data = await this.products.summary(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص المنتجات', currency: CURRENCY, ...data } };
        },
      },
    ];
  }
}
