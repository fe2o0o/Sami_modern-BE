import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service';
import { DashboardQueryDto } from '../../dashboard/dto/dashboard-query.dto';
import { TreasuryCashReportService } from '../../accounting-report/treasury-cash-report.service';
import { CashAccountsReportQueryDto } from '../../accounting-report/dto/cash-accounts-report-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, normalizeDate, optUuid } from './tool-helpers';

/** Treasury / bank / high-level financial tools. */
@Injectable()
export class FinanceAiTools {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly cashReport: TreasuryCashReportService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_financial_overview',
        description:
          'نظرة مالية عامة: المبيعات والمشتريات (مع التغير عن الفترة السابقة)، إجمالي المستحق على العملاء (مدينون)، المستحق للموردين (دائنون)، النقدية بالخزائن، صافي التدفق النقدي، وأكبر المدينين والدائنين.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            branchId: optUuid(args.branchId, 'branchId'),
          } as DashboardQueryDto;
          const data = await this.dashboard.financial(q, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'نظرة مالية عامة', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_cash_and_bank_summary',
        description:
          'أرصدة الخزائن والحسابات البنكية: لكل خزينة/حساب الرصيد الافتتاحي والوارد والمنصرف والرصيد الختامي خلال فترة، والرصيد الحالي الفعلي الآن (currentBalance — كل الحركات بغض النظر عن الفترة)، مع الإجماليات. هذا هو «تقرير الخزائن». جاوب من هنا على "كام رصيد الخزنة؟" و"كام فلوس في البنك؟". يحتوي أيضاً معرّفات (id) لكل خزينة/حساب لاستخدامها في كشف الحركة.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = await this.cashReport.summary(this.cashQuery(args), ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'أرصدة الخزائن والبنوك', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_treasury_statement',
        description: 'كشف حركة خزينة معيّنة خلال فترة (الرصيد الافتتاحي والحركات والرصيد الجاري). احصل على معرّف الخزينة من get_cash_and_bank_summary.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            treasuryId: { type: 'string', description: 'معرّف الخزينة (uuid)' },
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
          },
          required: ['treasuryId'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const id = optUuid(args.treasuryId, 'treasuryId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف الخزينة مطلوب.' };
          const data = await this.cashReport.statement('treasury', id, this.cashQuery(args), ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'كشف حركة الخزينة', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_bank_statement',
        description: 'كشف حركة حساب بنكي معيّن خلال فترة. احصل على معرّف الحساب من get_cash_and_bank_summary.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            bankAccountId: { type: 'string', description: 'معرّف الحساب البنكي (uuid)' },
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
          },
          required: ['bankAccountId'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const id = optUuid(args.bankAccountId, 'bankAccountId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف الحساب البنكي مطلوب.' };
          const data = await this.cashReport.statement('bank', id, this.cashQuery(args), ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'كشف حركة الحساب البنكي', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_top_debtors',
        description: 'أكبر العملاء المدينين (المبالغ المستحقة لنا عليهم). استخدمها لـ "مين أكتر العملاء عليهم فلوس؟".',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = (await this.dashboard.financial(this.range(args), ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'أكبر العملاء المدينين', currency: CURRENCY, topDebtors: data.topDebtors ?? [] } };
        },
      },
      {
        name: 'get_top_creditors',
        description: 'أكبر الموردين الدائنين (المستحق لهم علينا). استخدمها لـ "الموردين اللي لينا عندهم أرصدة".',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: { dateFrom: dateProp('بداية الفترة'), dateTo: dateProp('نهاية الفترة'), branchId: { type: 'string' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const data = (await this.dashboard.financial(this.range(args), ctx.branchScope)) as Record<string, unknown>;
          return { success: true, presentation: 'table', data: { title: 'أكبر الموردين الدائنين', currency: CURRENCY, topCreditors: data.topCreditors ?? [] } };
        },
      },
    ];
  }

  private range(args: Record<string, unknown>): DashboardQueryDto {
    return {
      dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
      dateTo: normalizeDate(args.dateTo, 'dateTo'),
      branchId: optUuid(args.branchId, 'branchId'),
    } as DashboardQueryDto;
  }

  private cashQuery(args: Record<string, unknown>): CashAccountsReportQueryDto {
    return {
      fromDate: normalizeDate(args.dateFrom, 'dateFrom'),
      toDate: normalizeDate(args.dateTo, 'dateTo'),
      branchId: optUuid(args.branchId, 'branchId'),
    } as CashAccountsReportQueryDto;
  }
}
