import { Injectable } from '@nestjs/common';
import { ManufacturingService } from '../../manufacturing/manufacturing.service';
import { ManufacturingOrderQueryDto } from '../../manufacturing/dto/manufacturing-order-query.dto';
import { ManufacturingOrderStatus } from '../../manufacturing/enums/manufacturing.enum';
import { AiExecutionContext, AiToolDefinition, AiToolResult } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optBool, optEnum, optStr, optUuid, pageArgs } from './tool-helpers';

const STATUSES = Object.values(ManufacturingOrderStatus);
const STATUS_DESC = 'الحالة: new (جديد) / in_progress (قيد التنفيذ) / produced (تم الإنتاج) / done (تم التنفيذ) / cancelled (ملغى)';

/** Manufacturing (production) order tools. All gated by `manufacturing.view` (the controller's GET routes). */
@Injectable()
export class ManufacturingAiTools {
  constructor(private readonly manufacturing: ManufacturingService) {}

  /** The list filters shared by the list and the summary (same as the screen). */
  private filters(args: Record<string, unknown>): Record<string, unknown> {
    return {
      status: optEnum(args.status, STATUSES, 'status'),
      customerId: optUuid(args.customerId, 'customerId'),
      factorySupplierId: optUuid(args.factorySupplierId, 'factorySupplierId'),
      productId: optUuid(args.productId, 'productId'),
      branchId: optUuid(args.branchId, 'branchId'),
      late: optBool(args.late),
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
      search: optStr(args.search),
    };
  }

  private filterProps(): Record<string, unknown> {
    return {
      status: { type: 'string', enum: STATUSES, description: STATUS_DESC },
      customerId: { type: 'string', description: 'معرّف العميل (uuid) — من search_customers' },
      factorySupplierId: { type: 'string', description: 'معرّف المصنع/المورد المنفّذ (uuid) — من search_suppliers' },
      productId: { type: 'string', description: 'معرّف المنتج (uuid)' },
      branchId: { type: 'string', description: 'فرع محدد (uuid)' },
      late: { type: 'boolean', description: 'true = المتأخرة فقط (تجاوزت تاريخ التسليم وما زالت جديدة/قيد التنفيذ)' },
      dateFrom: dateProp('تاريخ الأمر من'),
      dateTo: dateProp('تاريخ الأمر إلى'),
      search: { type: 'string', description: 'رقم الأمر أو رقم الفاتورة المصدر أو اسم المنتج' },
    };
  }

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_manufacturing_orders',
        description:
          'قائمة أوامر التصنيع (الإنتاج) مع فلاتر: الحالة، العميل، المصنع/المورد المنفّذ، المتأخرة فقط (late=true)، فترة تاريخ الأمر، بحث برقم الأمر/الفاتورة/المنتج. كل صف فيه المنتج والعميل والكمية وتاريخ التسليم ورسوم التصنيع والكمية المسلّمة وهل هو متأخر (isLate). مرقّمة.',
        permission: 'manufacturing.view',
        parameters: {
          type: 'object',
          properties: { ...this.filterProps(), page: { type: 'number' }, perPage: { type: 'number', description: 'حد أقصى 50' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 15, 50);
          const query = listQuery(page, perPage, this.filters(args)) as unknown as ManufacturingOrderQueryDto;
          const res = await this.manufacturing.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'أوامر التصنيع', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, orders: res.items },
          };
        },
      },
      {
        name: 'get_manufacturing_order',
        description:
          'تفاصيل أمر تصنيع واحد (بالمعرّف أو برقم الأمر مثل MO-0001): المنتج والعميل والكمية والمواصفات والحالة وتاريخ التسليم والمصنع المنفّذ ورسوم التصنيع والتكلفة والمكوّنات (الخامات وكمياتها وتكلفتها) وسعر البيع من الفاتورة المرتبطة.',
        permission: 'manufacturing.view',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'معرّف الأمر (uuid)' },
            orderNumber: { type: 'string', description: 'رقم الأمر (إن لم يتوفر المعرّف)' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => this.orderDetail(args, ctx),
      },
      {
        name: 'get_manufacturing_summary',
        description:
          'تحليل/ملخص أوامر التصنيع بنفس فلاتر القائمة: العدد حسب الحالة (جديد/قيد التنفيذ/تم الإنتاج/تم التنفيذ/ملغى)، عدد المتأخرة، الداخلي مقابل الخارجي (لدى مصنع)، إجمالي الكمية، إجمالي رسوم التصنيع والمُسجّل منها. استخدمها لأسئلة مثل "كم أمر تصنيع متأخر؟" أو "إجمالي رسوم التصنيع هذا الشهر". الرسوم تستبعد الملغاة ما لم تُحدَّد حالة.',
        permission: 'manufacturing.view',
        parameters: { type: 'object', properties: this.filterProps(), additionalProperties: false },
        handler: async (args, ctx) => {
          const data = await this.manufacturing.summary(this.filters(args) as unknown as ManufacturingOrderQueryDto, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ملخص أوامر التصنيع', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_supplier_manufacturing',
        description:
          'كشف أوامر التصنيع لدى مصنع/مورد معيّن: عدد الأوامر المفتوحة والمتأخرة والمُنتجة والمنتهية، إجمالي رسوم التصنيع والمُسجّل منها، وقائمة الأوامر. احصل على معرّف المورد من search_suppliers.',
        permission: 'manufacturing.view',
        parameters: {
          type: 'object',
          properties: { supplierId: { type: 'string', description: 'معرّف المورد/المصنع (uuid)' } },
          required: ['supplierId'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const supplierId = optUuid(args.supplierId, 'supplierId');
          if (!supplierId) return { success: false, code: 'INVALID_ARGS', message: 'معرّف المورد مطلوب.' };
          const res = await this.manufacturing.bySupplier(supplierId, ctx.branchScope);
          return {
            success: true,
            presentation: 'report',
            data: { title: 'أوامر التصنيع لدى المصنع', currency: CURRENCY, ...res.summary, orders: res.orders.slice(0, 50) },
          };
        },
      },
    ];
  }

  /** Resolve an order by id or number (via the list's search), then load its detail. */
  private async orderDetail(args: Record<string, unknown>, ctx: AiExecutionContext): Promise<AiToolResult> {
    let id = optUuid(args.id, 'id');
    const number = optStr(args.orderNumber);
    if (!id && !number) return { success: false, code: 'INVALID_ARGS', message: 'حدّد معرّف أمر التصنيع أو رقمه.' };
    if (!id && number) {
      const res = await this.manufacturing.findAll(
        listQuery(1, 10, { search: number }) as unknown as ManufacturingOrderQueryDto,
        ctx.branchScope,
      );
      const exact = res.items.filter((o) => (o.orderNumber ?? '').toLowerCase() === number.toLowerCase());
      const matches = exact.length ? exact : res.items;
      if (!matches.length) {
        return { success: false, code: 'MANUFACTURING_ORDER_NOT_FOUND', message: `لا يوجد أمر تصنيع برقم "${number}".` };
      }
      if (matches.length > 1) {
        return {
          success: true,
          presentation: 'table',
          data: { title: 'أوامر تصنيع مطابقة — اختر واحداً', currency: CURRENCY, orders: matches },
        };
      }
      id = matches[0].id;
    }
    const d = (await this.manufacturing.findOneDetailed(id!, ctx.branchScope)) as Record<string, unknown>;
    const components = (Array.isArray(d.components) ? d.components : []) as Record<string, unknown>[];
    return {
      success: true,
      presentation: 'report',
      data: {
        title: `أمر التصنيع ${d.orderNumber ?? ''}`.trim(),
        currency: CURRENCY,
        id: d.id,
        orderNumber: d.orderNumber,
        orderDate: d.orderDate,
        status: d.status,
        productName: d.productName,
        customerName: d.customerName,
        quantity: d.quantity,
        deliveryDate: d.deliveryDate,
        dimensions: d.dimensions,
        color: d.color,
        material: d.material,
        specifications: d.specifications,
        sourceNumber: d.sourceNumber,
        factorySupplierName: d.factorySupplierName,
        manufacturingFee: d.manufacturingFee,
        feeBookedAt: d.feeBookedAt,
        totalCost: d.totalCost,
        sellingUnitPrice: d.sellingUnitPrice,
        sellingNet: d.sellingNet,
        startedAt: d.startedAt,
        producedAt: d.producedAt,
        doneAt: d.doneAt,
        branchName: d.branchName,
        notes: d.notes,
        components: components.map((c) => ({
          productName: c.componentProductName,
          unitName: c.unitName,
          quantity: c.quantity,
          unitCost: c.unitCost,
          lineCost: c.lineCost,
        })),
      },
    };
  }
}
