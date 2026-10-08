import { Injectable } from '@nestjs/common';
import { InventoryAdjustmentService } from '../../inventory-adjustment/inventory-adjustment.service';
import { InventoryAdjustmentQueryDto } from '../../inventory-adjustment/dto/inventory-adjustment-query.dto';
import { InventoryAdjustmentStatus } from '../../inventory-adjustment/enums/inventory-adjustment.enum';
import { StockTransferService } from '../../stock-transfer/stock-transfer.service';
import { StockTransferQueryDto } from '../../stock-transfer/dto/stock-transfer-query.dto';
import { StockTransferStatus } from '../../stock-transfer/enums/stock-transfer.enum';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optEnum, optStr, optUuid, pageArgs } from './tool-helpers';

const DOC_STATUS_DESC = 'draft (مسودة) / posted (مُرحّل) / reversed (معكوس)';

/**
 * Inventory documents: adjustments (تسويات) and warehouse transfers (تحويلات).
 * Permissions mirror the controllers' GET routes.
 */
@Injectable()
export class InventoryOpsAiTools {
  constructor(
    private readonly adjustments: InventoryAdjustmentService,
    private readonly transfers: StockTransferService,
  ) {}

  private filters(args: Record<string, unknown>, statuses: readonly string[]): Record<string, unknown> {
    return {
      status: optEnum(args.status, statuses, 'status'),
      warehouseId: optUuid(args.warehouseId, 'warehouseId'),
      fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
      search: optStr(args.search),
    };
  }

  private filterProps(statuses: readonly string[], whDesc: string): Record<string, unknown> {
    return {
      status: { type: 'string', enum: statuses, description: DOC_STATUS_DESC },
      warehouseId: { type: 'string', description: whDesc },
      fiscalYearId: { type: 'string', description: 'معرّف السنة المالية (uuid)' },
      dateFrom: dateProp('بداية الفترة'),
      dateTo: dateProp('نهاية الفترة'),
      search: { type: 'string', description: 'رقم المستند' },
    };
  }

  defs(): AiToolDefinition[] {
    const adjStatuses = Object.values(InventoryAdjustmentStatus);
    const trStatuses = Object.values(StockTransferStatus);
    return [
      {
        name: 'get_inventory_adjustments',
        description: 'قائمة تسويات المخزون (زيادة/عجز في أرصدة الأصناف) مع فلاتر (الحالة، المخزن، الفترة، رقم التسوية). كل صف: الرقم والتاريخ والمخزن وعدد الأصناف والقيمة والحالة. مرقّمة.',
        permission: 'inventory_adjustments.view',
        parameters: {
          type: 'object',
          properties: { ...this.filterProps(adjStatuses, 'معرّف المخزن (uuid)'), page: { type: 'number' }, perPage: { type: 'number', description: 'حد أقصى 50' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 15, 50);
          const query = listQuery(page, perPage, this.filters(args, adjStatuses)) as unknown as InventoryAdjustmentQueryDto;
          const res = await this.adjustments.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'تسويات المخزون', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, adjustments: res.items },
          };
        },
      },
      {
        name: 'get_adjustments_summary',
        description: 'ملخص تسويات المخزون بنفس فلاتر القائمة: العدد حسب الحالة، كميات وقيم الزيادة والعجز وصافي القيمة (القيم محسوبة على المُرحّل ما لم تُحدَّد حالة).',
        permission: 'inventory_adjustments.view',
        parameters: { type: 'object', properties: this.filterProps(adjStatuses, 'معرّف المخزن (uuid)'), additionalProperties: false },
        handler: async (args, ctx) => {
          const data = await this.adjustments.summary(this.filters(args, adjStatuses) as unknown as InventoryAdjustmentQueryDto, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص تسويات المخزون', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_stock_transfers',
        description: 'قائمة التحويلات بين المخازن مع فلاتر (الحالة، المخزن، الفترة، رقم التحويل). كل صف: الرقم والتاريخ ومن مخزن/إلى مخزن وعدد الأصناف والقيمة والحالة. مرقّمة.',
        permission: 'stock_transfers.view',
        parameters: {
          type: 'object',
          properties: { ...this.filterProps(trStatuses, 'معرّف المخزن (uuid) — المحوَّل منه أو إليه'), page: { type: 'number' }, perPage: { type: 'number', description: 'حد أقصى 50' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 15, 50);
          const query = listQuery(page, perPage, this.filters(args, trStatuses)) as unknown as StockTransferQueryDto;
          const res = await this.transfers.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'التحويلات بين المخازن', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, transfers: res.items },
          };
        },
      },
      {
        name: 'get_transfers_summary',
        description: 'ملخص التحويلات بين المخازن بنفس فلاتر القائمة: العدد حسب الحالة، إجمالي الكمية المحوّلة وعدد الأصناف وإجمالي القيمة (على المُرحّل ما لم تُحدَّد حالة).',
        permission: 'stock_transfers.view',
        parameters: { type: 'object', properties: this.filterProps(trStatuses, 'معرّف المخزن (uuid) — المحوَّل منه أو إليه'), additionalProperties: false },
        handler: async (args, ctx) => {
          const data = await this.transfers.summary(this.filters(args, trStatuses) as unknown as StockTransferQueryDto, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص التحويلات', currency: CURRENCY, ...data } };
        },
      },
    ];
  }
}
