import { Injectable } from '@nestjs/common';
import { ProductIncomeReportService } from '../../accounting-report/product-income-report.service';
import {
  PRODUCT_INCOME_COMPARE,
  PRODUCT_INCOME_PRESETS,
  PRODUCT_INCOME_SORT,
  ProductIncomeQueryDto,
} from '../../accounting-report/dto/product-income-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, normalizeDate, optEnum, optStr, optUuid, pageArgs } from './tool-helpers';

/** Analytical reports. Permissions mirror accounting-report.controller.ts. */
@Injectable()
export class ReportsAiTools {
  constructor(private readonly productIncome: ProductIncomeReportService) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_product_income_summary',
        description:
          'تقرير دخل/ربحية المنتجات خلال فترة: لكل منتج الكمية المباعة والمرتجعة والمسلّمة، الإيراد الإجمالي والمرتجعات وصافي الإيراد، تكلفة المبيعات ومجمل الربح وهامش الربح، مع الإجماليات وأعلى المنتجات ربحاً والأقل هامشاً والتوزيع حسب التصنيف والاتجاه الزمني ومقارنة اختيارية بفترة سابقة. ' +
          'قاعدة التكلفة (مقصودة): الإيراد يُثبت بتاريخ الفاتورة المُرحّلة، أما التكلفة فتُثبت بتاريخ التسليم الفعلي (مثل دفتر الأستاذ)؛ المنتج الخدمي أو المخزني الذي بيع ولم يُسلَّم بعد ليس له أساس تكلفة في الفترة فتظهر حقول الربح له فارغة (null) بدل هامش 100% مضلل، و cogsCoveragePct = نسبة الإيراد المغطّاة بتكلفة. وضّح ذلك للمستخدم عند الحاجة. ' +
          'الفترة: preset (this_month افتراضياً، today، last_month، this_year، fiscal_year …) أو from/to مخصص.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            preset: { type: 'string', enum: [...PRODUCT_INCOME_PRESETS], description: 'فترة جاهزة؛ custom مع from/to' },
            from: dateProp('بداية فترة مخصصة'),
            to: dateProp('نهاية فترة مخصصة'),
            branchId: { type: 'string', description: 'فرع (uuid)' },
            warehouseId: { type: 'string', description: 'مخزن (uuid)' },
            productId: { type: 'string', description: 'منتج (uuid)' },
            categoryId: { type: 'string', description: 'تصنيف (uuid)' },
            brandId: { type: 'string', description: 'علامة تجارية (uuid)' },
            customerId: { type: 'string', description: 'عميل (uuid)' },
            search: { type: 'string', description: 'كود/اسم المنتج' },
            sortBy: { type: 'string', enum: [...PRODUCT_INCOME_SORT], description: 'ترتيب جدول المنتجات (افتراضي netRevenue)' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'] },
            compare: { type: 'string', enum: [...PRODUCT_INCOME_COMPARE], description: 'مقارنة: previous (الفترة السابقة) / month / year' },
            page: { type: 'number' },
            perPage: { type: 'number', description: 'حد أقصى 50' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 15, 50);
          const q = {
            preset: optEnum(args.preset, PRODUCT_INCOME_PRESETS, 'preset'),
            from: normalizeDate(args.from, 'from'),
            to: normalizeDate(args.to, 'to'),
            branchId: optUuid(args.branchId, 'branchId'),
            warehouseId: optUuid(args.warehouseId, 'warehouseId'),
            productId: optUuid(args.productId, 'productId'),
            categoryId: optUuid(args.categoryId, 'categoryId'),
            brandId: optUuid(args.brandId, 'brandId'),
            customerId: optUuid(args.customerId, 'customerId'),
            search: optStr(args.search)?.slice(0, 100),
            sortBy: optEnum(args.sortBy, PRODUCT_INCOME_SORT, 'sortBy') ?? 'netRevenue',
            sortOrder: optEnum(args.sortOrder, ['asc', 'desc'] as const, 'sortOrder') ?? 'desc',
            compare: optEnum(args.compare, PRODUCT_INCOME_COMPARE, 'compare'),
            page,
            perPage,
          } as ProductIncomeQueryDto;
          const r = await this.productIncome.summary(q, ctx.branchScope);
          const brief = (rows: typeof r.products.items) =>
            rows.map((p) => ({
              // Most useful first (the chat table shows ~10 columns).
              productName: p.productName,
              categoryName: p.categoryName,
              quantitySold: p.quantitySold,
              netRevenue: p.netRevenue,
              cogs: p.cogs,
              grossProfit: p.grossProfit,
              grossMargin: p.grossMargin,
              quantityDelivered: p.quantityDelivered,
              returns: p.returns,
              grossRevenue: p.grossRevenue,
              quantityReturned: p.quantityReturned,
              sku: p.sku,
            }));
          return {
            success: true,
            presentation: 'report',
            data: {
              title: 'دخل المنتجات',
              currency: CURRENCY,
              period: { from: r.period.from, to: r.period.to },
              preset: r.period.preset,
              ...r.summary,
              comparison: r.comparison
                ? {
                    from: r.comparison.period.from,
                    to: r.comparison.period.to,
                    netRevenue: r.comparison.summary.netRevenue,
                    grossProfit: r.comparison.summary.grossProfit,
                    netRevenueGrowthPct: r.comparison.growth.netRevenue,
                    grossProfitGrowthPct: r.comparison.growth.grossProfit,
                    quantitySoldGrowthPct: r.comparison.growth.quantitySold,
                  }
                : null,
              total: r.products.total,
              page: r.products.page,
              products: brief(r.products.items),
              topByProfit: brief(r.top.byProfit),
              lowMargin: brief(r.top.lowMargin),
              byCategory: r.byCategory.map((c) => ({ categoryName: c.categoryName, netRevenue: c.netRevenue, sharePct: c.sharePct })),
              trend: r.trend.map((t) => ({ bucket: t.bucket, total: t.netRevenue, cogs: t.cogs })),
            },
          };
        },
      },
    ];
  }
}
