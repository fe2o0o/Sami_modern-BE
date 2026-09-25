import { Injectable } from '@nestjs/common';
import { FiscalYearService } from '../../fiscal-year/fiscal-year.service';
import { AccountingPeriodService } from '../../accounting-period/accounting-period.service';
import { AccountingSettingService } from '../../accounting-setting/accounting-setting.service';
import { AiToolDefinition } from '../types/ai.types';
import { optUuid } from './tool-helpers';

/** Context tools: fiscal year / periods / settings / who-am-I. */
@Injectable()
export class ContextAiTools {
  constructor(
    private readonly fiscalYears: FiscalYearService,
    private readonly periods: AccountingPeriodService,
    private readonly settings: AccountingSettingService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_current_fiscal_year',
        description: 'السنة المالية الحالية (المعرّف والاسم وتواريخ البداية/النهاية وحالتها). استخدمها قبل أي تقرير محاسبي يتطلب سنة مالية.',
        permission: 'fiscal_years.view',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
          const fy = await this.fiscalYears.findCurrent();
          if (!fy) return { success: false, code: 'NO_FISCAL_YEAR', message: 'لا توجد سنة مالية حالية محددة.' };
          return {
            success: true,
            data: { id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate, isClosed: fy.isClosed, isCurrent: fy.isCurrent },
          };
        },
      },
      {
        name: 'get_accounting_periods',
        description: 'الفترات المحاسبية لسنة مالية (اسم الفترة وتواريخها وحالة الإغلاق).',
        permission: 'fiscal_years.view',
        parameters: {
          type: 'object',
          properties: { fiscalYearId: { type: 'string', description: 'السنة المالية (uuid) — اختياري، الافتراضي الحالية' } },
          additionalProperties: false,
        },
        handler: async (args) => {
          let fyId = optUuid(args.fiscalYearId, 'fiscalYearId');
          if (!fyId) {
            const current = await this.fiscalYears.findCurrent();
            if (!current) return { success: false, code: 'NO_FISCAL_YEAR', message: 'لا توجد سنة مالية حالية.' };
            fyId = current.id;
          }
          const rows = await this.periods.findByFiscalYear(fyId);
          return {
            success: true,
            presentation: 'table',
            data: { periods: rows.map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, isClosed: p.isClosed })) },
          };
        },
      },
      {
        name: 'get_accounting_settings',
        description: 'إعدادات المحاسبة (الحسابات الافتراضية للنظام: المبيعات/المخزون/الموردين/العملاء/الضرائب...).',
        permission: 'accounting_settings.view',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        handler: async () => {
          const s = await this.settings.get();
          return { success: true, data: s };
        },
      },
      {
        name: 'get_user_context',
        description: 'سياق المستخدم الحالي: الصلاحيات المتاحة ونطاق الفروع (لتوضيح ما يمكنه رؤيته/فعله).',
        // No permission — self-context only.
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => ({
          success: true,
          data: {
            userId: ctx.userId,
            isSuperAdmin: ctx.isSuperAdmin,
            branchScope: ctx.branchScope === null ? 'كل الفروع' : ctx.branchScope,
            permissionsCount: ctx.permissions.length,
            permissions: ctx.permissions,
            serverTime: ctx.now.toISOString(),
          },
        }),
      },
    ];
  }
}
