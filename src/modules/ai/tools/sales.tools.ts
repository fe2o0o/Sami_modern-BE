import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { DashboardQueryDto } from '../../dashboard/dto/dashboard-query.dto';
import { SalesInvoiceService } from '../../sales-invoice/sales-invoice.service';
import { SalesInvoiceQueryDto } from '../../sales-invoice/dto/sales-invoice-query.dto';
import { SalesReturnService } from '../../sales-return/sales-return.service';
import { SalesReturnQueryDto } from '../../sales-return/dto/sales-return-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optStr, optUuid } from './tool-helpers';

/** Sales read/aggregate tools. */
@Injectable()
export class SalesAiTools {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly invoices: SalesInvoiceService,
    private readonly returns: SalesReturnService,
  ) {}

  private range(args: Record<string, unknown>): DashboardQueryDto {
    return {
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
      branchId: optUuid(args.branchId, 'branchId'),
    } as DashboardQueryDto;
  }

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_sales_summary',
        description:
          'ملخص المبيعات خلال فترة: الإجمالي والعدد والمتوسط والمرتجعات ومزيج الدفع (نقدي/آجل) وحالة التسليم وأفضل المنتجات والعملاء. الافتراضي: الشهر الحالي.',
        permission: 'sales_invoices.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            branchId: { type: 'string', description: 'فرع محدد (uuid) — اختياري' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = await this.dashboard.sales(this.range(args), ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص المبيعات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_top_customers',
        description: 'أفضل العملاء من حيث المبيعات خلال فترة.',
        permission: 'sales_invoices.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = (await this.dashboard.sales(this.range(args), ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'أفضل العملاء', currency: CURRENCY, topCustomers: data.topCustomers ?? [] } };
        },
      },
      {
        name: 'get_top_products',
        description: 'أكثر المنتجات مبيعاً خلال فترة.',
        permission: 'sales_invoices.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = (await this.dashboard.sales(this.range(args), ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'أكثر المنتجات مبيعاً', currency: CURRENCY, topProducts: data.topProducts ?? [] } };
        },
      },
      {
        name: 'get_sales_invoices',
        description: 'قائمة فواتير المبيعات مع فلاتر (فترة/عميل/حالة/فرع). مرقّمة — استخدم page/perPage.',
        permission: 'sales_invoices.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            customerId: { type: 'string', description: 'عميل محدد (uuid)' },
            status: { type: 'string', description: 'حالة الفاتورة (draft/posted/reversed/cancelled)' },
            branchId: { type: 'string' },
            search: { type: 'string', description: 'رقم الفاتورة' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            customerId: optUuid(args.customerId, 'customerId'),
            status: optStr(args.status),
            branchId: optUuid(args.branchId, 'branchId'),
            search: optStr(args.search),
          }) as unknown as SalesInvoiceQueryDto;
          const res = await this.invoices.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'فواتير المبيعات', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, invoices: res.items },
          };
        },
      },
      {
        name: 'get_sales_returns',
        description: 'قائمة مردودات المبيعات مع فلاتر (فترة/عميل/حالة). مرقّمة.',
        permission: 'sales_returns.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            customerId: { type: 'string' },
            status: { type: 'string' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            customerId: optUuid(args.customerId, 'customerId'),
            status: optStr(args.status),
          }) as unknown as SalesReturnQueryDto;
          const res = await this.returns.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'مردودات المبيعات', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, returns: res.items },
          };
        },
      },
    ];
  }
}
