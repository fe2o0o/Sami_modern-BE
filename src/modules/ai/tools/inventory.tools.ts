import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { DashboardQueryDto } from '../../dashboard/dto/dashboard-query.dto';
import { StockService } from '../../stock/stock.service';
import { StockQueryDto } from '../../stock/dto/stock-query.dto';
import { StockMovementQueryDto } from '../../stock/dto/stock-movement-query.dto';
import { ProductService } from '../../product/product.service';
import { QueryProductDto } from '../../product/dto/query-product.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optStr, optUuid } from './tool-helpers';

/** Inventory read/aggregate tools. All gated by `stock.view`. */
@Injectable()
export class InventoryAiTools {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly stock: StockService,
    private readonly products: ProductService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_inventory_summary',
        description:
          'ملخص المخزون: قيمة المخزون وعدد الأصناف وعدد الأصناف تحت الحد الأدنى/المنتهية وتوزيع المخزون على المخازن وحالة أوامر التصنيع.',
        permission: 'stock.view',
        parameters: {
          type: 'object',
          properties: { branchId: { type: 'string', description: 'فرع محدد (uuid) — اختياري' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = { branchId: optUuid(args.branchId, 'branchId') } as DashboardQueryDto;
          const data = await this.dashboard.inventory(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص المخزون', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_low_stock_products',
        description: 'المنتجات التي قاربت على النفاد (الكمية ≤ حد إعادة الطلب).',
        permission: 'stock.view',
        parameters: {
          type: 'object',
          properties: { branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = { branchId: optUuid(args.branchId, 'branchId') } as DashboardQueryDto;
          const data = (await this.dashboard.inventory(q, ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'منتجات قاربت على النفاد', lowStock: data.lowStock ?? [], lowStockCount: data.lowStockCount ?? 0, outOfStockCount: data.outOfStockCount ?? 0 } };
        },
      },
      {
        name: 'get_stock_balances',
        description: 'أرصدة المخزون الحالية (الكمية المتاحة ومتوسط التكلفة) لكل صنف/مخزن. مرقّمة؛ يمكن التصفية بمخزن أو بحث بالكود/الاسم.',
        permission: 'stock.view',
        parameters: {
          type: 'object',
          properties: {
            warehouseId: { type: 'string', description: 'مخزن محدد (uuid)' },
            search: { type: 'string', description: 'كود أو اسم المنتج' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const warehouseId = optUuid(args.warehouseId, 'warehouseId');
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            search: optStr(args.search),
          }) as unknown as StockQueryDto;
          const res = await this.stock.findAll(query, warehouseId, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'أرصدة المخزون', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, balances: res.items },
          };
        },
      },
      {
        name: 'get_stock_movements',
        description: 'حركات المخزون (وارد/صادر) مع فلاتر (مخزن/منتج/نوع الحركة/فترة). مرقّمة.',
        permission: 'stock.view',
        parameters: {
          type: 'object',
          properties: {
            warehouseId: { type: 'string' },
            productId: { type: 'string' },
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            warehouseId: optUuid(args.warehouseId, 'warehouseId'),
            productId: optUuid(args.productId, 'productId'),
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
          }) as unknown as StockMovementQueryDto;
          const res = await this.stock.findMovements(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'حركات المخزون', total: res.meta.totalItems, page: res.meta.currentPage, movements: res.items },
          };
        },
      },
      {
        name: 'search_products',
        description: 'ابحث عن منتجات بالكود/الاسم/الباركود لإيجاد معرّف المنتج أو معرفة سعره وتصنيفه.',
        permission: 'products.view',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'كود/اسم/باركود المنتج' } },
          required: ['query'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const q = optStr(args.query);
          if (!q) return { success: false, code: 'INVALID_ARGS', message: 'اكتب اسم أو كود المنتج.' };
          const res = await this.products.findAll(listQuery(1, 10, { search: q }) as unknown as QueryProductDto);
          const rows = res.items.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            productType: p.productType,
            sellingPrice: p.sellingPrice,
            unit: p.unit?.name ?? null,
          }));
          if (!rows.length) return { success: false, code: 'PRODUCT_NOT_FOUND', message: `لا يوجد منتج مطابق لـ "${q}".` };
          return { success: true, presentation: rows.length > 1 ? 'ambiguous' : 'table', data: { entity: 'product', count: res.meta.totalItems, results: rows } };
        },
      },
    ];
  }
}
