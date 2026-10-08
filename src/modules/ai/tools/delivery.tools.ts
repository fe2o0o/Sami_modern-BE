import { Injectable } from '@nestjs/common';
import { SalesDeliveryService } from '../../sales-delivery/sales-delivery.service';
import { SalesDeliveryQueryDto } from '../../sales-delivery/dto/sales-delivery-query.dto';
import { SalesDeliveryStatus } from '../../sales-delivery/enums/sales-delivery.enum';
import { AiExecutionContext, AiToolDefinition, AiToolResult } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optEnum, optStr, optUuid, pageArgs } from './tool-helpers';

const STATUSES = Object.values(SalesDeliveryStatus);

/** Sales delivery orders (أذون/أوامر التسليم). Gated by `sales_deliveries.view` (the controller's GET routes). */
@Injectable()
export class DeliveryAiTools {
  constructor(private readonly deliveries: SalesDeliveryService) {}

  private filters(args: Record<string, unknown>): Record<string, unknown> {
    return {
      status: optEnum(args.status, STATUSES, 'status'),
      customerId: optUuid(args.customerId, 'customerId'),
      salesInvoiceId: optUuid(args.salesInvoiceId, 'salesInvoiceId'),
      warehouseId: optUuid(args.warehouseId, 'warehouseId'),
      fiscalYearId: optUuid(args.fiscalYearId, 'fiscalYearId'),
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
      search: optStr(args.search),
    };
  }

  private filterProps(): Record<string, unknown> {
    return {
      status: { type: 'string', enum: STATUSES, description: 'draft (مفتوح/مسودة — الأصناف تُسلَّم سطراً بسطر) / posted (مُرحّل) / reversed (معكوس)' },
      customerId: { type: 'string', description: 'معرّف العميل (uuid)' },
      salesInvoiceId: { type: 'string', description: 'معرّف فاتورة المبيعات (uuid)' },
      warehouseId: { type: 'string', description: 'معرّف المخزن (uuid)' },
      fiscalYearId: { type: 'string', description: 'معرّف السنة المالية (uuid)' },
      dateFrom: dateProp('تاريخ الإذن من'),
      dateTo: dateProp('تاريخ الإذن إلى'),
      search: { type: 'string', description: 'رقم إذن التسليم أو رقم الفاتورة' },
    };
  }

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_delivery_orders',
        description:
          'قائمة أوامر/أذون التسليم للعملاء مع فلاتر (الحالة، العميل، الفاتورة، المخزن، الفترة، بحث برقم الإذن/الفاتورة). كل صف فيه رقم الإذن والفاتورة والعميل وعدد الأصناف والتكلفة والحالة ومدى التسليم (deliveryProgress: pending غير مسلّم / partial جزئي / delivered تم). مرقّمة.',
        permission: 'sales_deliveries.view',
        parameters: {
          type: 'object',
          properties: { ...this.filterProps(), page: { type: 'number' }, perPage: { type: 'number', description: 'حد أقصى 50' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 15, 50);
          const query = listQuery(page, perPage, this.filters(args)) as unknown as SalesDeliveryQueryDto;
          const res = await this.deliveries.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'أوامر التسليم', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, deliveries: res.items },
          };
        },
      },
      {
        name: 'get_delivery_order',
        description:
          'تفاصيل أمر تسليم واحد (بالمعرّف أو برقم الإذن أو رقم الفاتورة): لكل صنف الكمية المطلوبة والمسلّمة (deliveredQuantity) والملغاة (cancelledQuantity) والمتبقية، ولأصناف التصنيع حالة التصنيع manufacturingState: pending = أمر التصنيع لم يُنتج بعد (انتظر)، produced = تم الإنتاج ويمكن التسليم، cancelled أو missing = أمر التصنيع ملغى أو غير موجود/محذوف → السطر يحتاج إجراء: إنشاء أمر تصنيع جديد، أو التسليم من المخزون، أو إلغاء الصنف (مرتجع).',
        permission: 'sales_deliveries.view',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'معرّف أمر التسليم (uuid)' },
            number: { type: 'string', description: 'رقم إذن التسليم أو رقم الفاتورة (إن لم يتوفر المعرّف)' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => this.detail(args, ctx),
      },
      {
        name: 'get_deliveries_summary',
        description:
          'تحليل/ملخص أوامر التسليم بنفس فلاتر القائمة: العدد حسب الحالة، عدد الأوامر المعلّقة (لم تُسلَّم بالكامل) والجزئية والمتأخرة عن التاريخ المتوقع، الكمية المطلوبة والمسلّمة والمتبقية ونسبة التسليم، وإجمالي تكلفة البضاعة المسلّمة. استخدمها لـ "كم أمر تسليم متأخر؟" أو "نسبة التسليم".',
        permission: 'sales_deliveries.view',
        parameters: { type: 'object', properties: this.filterProps(), additionalProperties: false },
        handler: async (args, ctx) => {
          const data = await this.deliveries.summary(this.filters(args) as unknown as SalesDeliveryQueryDto, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص أوامر التسليم', currency: CURRENCY, ...data } };
        },
      },
    ];
  }

  private async detail(args: Record<string, unknown>, ctx: AiExecutionContext): Promise<AiToolResult> {
    let id = optUuid(args.id, 'id');
    const number = optStr(args.number);
    if (!id && !number) return { success: false, code: 'INVALID_ARGS', message: 'حدّد معرّف أمر التسليم أو رقمه.' };
    if (!id && number) {
      const res = await this.deliveries.findAll(listQuery(1, 10, { search: number }) as unknown as SalesDeliveryQueryDto, ctx.branchScope);
      const n = number.toLowerCase();
      const exact = res.items.filter((d) => (d.deliveryNumber ?? '').toLowerCase() === n || (d.invoiceNumber ?? '').toLowerCase() === n);
      const matches = exact.length ? exact : res.items;
      if (!matches.length) return { success: false, code: 'DELIVERY_NOT_FOUND', message: `لا يوجد أمر تسليم برقم "${number}".` };
      if (matches.length > 1) {
        return { success: true, presentation: 'table', data: { title: 'أوامر تسليم مطابقة — اختر واحداً', currency: CURRENCY, deliveries: matches } };
      }
      id = matches[0].id;
    }
    const d = (await this.deliveries.findOneDetailed(id!, ctx.branchScope)) as Record<string, unknown>;
    const items = (Array.isArray(d.items) ? d.items : []) as Record<string, unknown>[];
    const rows = items.map((it) => {
      // Same reading as the service: remaining = ordered − delivered − cancelled; a POSTED
      // (standalone) note issued its full quantity at post time.
      const ordered = Number(it.orderedQuantity ?? it.quantity) || 0;
      const delivered =
        d.status === SalesDeliveryStatus.POSTED
          ? Math.max(Number(it.deliveredQuantity) || 0, Number(it.quantity) || 0)
          : Number(it.deliveredQuantity) || 0;
      const cancelled = Number(it.cancelledQuantity) || 0;
      return {
        productCode: it.productCode,
        productName: it.productName,
        unitName: it.unitName,
        lineType: it.lineType,
        orderedQuantity: ordered,
        deliveredQuantity: delivered,
        cancelledQuantity: cancelled,
        remainingQuantity: Math.max(Math.round((ordered - delivered - cancelled) * 1000) / 1000, 0),
        actualDeliveryDate: it.actualDeliveryDate ?? null,
        manufacturingState: it.manufacturingState ?? null,
        manufacturingOrderNumber: it.manufacturingOrderNumber ?? null,
        lineCost: it.lineCost,
      };
    });
    const needsAction = rows.filter((r) => r.manufacturingState === 'cancelled' || r.manufacturingState === 'missing').length;
    return {
      success: true,
      presentation: 'report',
      data: {
        title: `أمر التسليم ${d.deliveryNumber ?? ''}`.trim(),
        currency: CURRENCY,
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        deliveryDate: d.deliveryDate,
        expectedDeliveryDate: d.expectedDeliveryDate,
        invoiceNumber: d.invoiceNumber,
        customerName: d.customerName,
        warehouseName: d.warehouseName,
        branchName: d.branchName,
        status: d.status,
        deliveryProgress: d.deliveryProgress,
        totalCost: d.totalCost,
        linesNeedingAction: needsAction,
        notes: d.notes,
        items: rows,
      },
    };
  }
}
