import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { DashboardQueryDto } from '../../dashboard/dto/dashboard-query.dto';
import { PurchaseInvoiceService } from '../../purchase-invoice/purchase-invoice.service';
import { PurchaseInvoiceQueryDto } from '../../purchase-invoice/dto/purchase-invoice-query.dto';
import { PurchaseReturnService } from '../../purchase-return/purchase-return.service';
import { PurchaseReturnQueryDto } from '../../purchase-return/dto/purchase-return-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optStr, optUuid } from './tool-helpers';

/** Purchase read/aggregate tools. */
@Injectable()
export class PurchaseAiTools {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly invoices: PurchaseInvoiceService,
    private readonly returns: PurchaseReturnService,
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
        name: 'get_purchase_summary',
        description: 'ملخص المشتريات خلال فترة: الإجمالي والعدد والمرتجعات وأفضل الموردين والمنتجات. الافتراضي: الشهر الحالي.',
        permission: 'purchase_invoices.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = await this.dashboard.purchases(this.range(args), ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص المشتريات', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_top_suppliers',
        description: 'أفضل الموردين من حيث المشتريات خلال فترة.',
        permission: 'purchase_invoices.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = (await this.dashboard.purchases(this.range(args), ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'أفضل الموردين', currency: CURRENCY, topSuppliers: data.topSuppliers ?? [] } };
        },
      },
      {
        name: 'get_purchase_invoices',
        description: 'قائمة فواتير المشتريات مع فلاتر (فترة/مورد/حالة/فرع). مرقّمة.',
        permission: 'purchase_invoices.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            supplierId: { type: 'string', description: 'مورد محدد (uuid)' },
            status: { type: 'string' },
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
            supplierId: optUuid(args.supplierId, 'supplierId'),
            status: optStr(args.status),
            branchId: optUuid(args.branchId, 'branchId'),
            search: optStr(args.search),
          }) as unknown as PurchaseInvoiceQueryDto;
          const res = await this.invoices.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'فواتير المشتريات', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, invoices: res.items },
          };
        },
      },
      {
        name: 'get_purchase_returns',
        description: 'قائمة مردودات المشتريات مع فلاتر (فترة/مورد/حالة). مرقّمة.',
        permission: 'purchase_returns.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            supplierId: { type: 'string' },
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
            supplierId: optUuid(args.supplierId, 'supplierId'),
            status: optStr(args.status),
          }) as unknown as PurchaseReturnQueryDto;
          const res = await this.returns.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'مردودات المشتريات', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, returns: res.items },
          };
        },
      },
    ];
  }
}
