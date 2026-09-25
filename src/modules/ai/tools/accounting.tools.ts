import { Injectable } from '@nestjs/common';
import { ChartOfAccountService } from '../../chart-of-account/chart-of-account.service';
import { FiscalYearService } from '../../fiscal-year/fiscal-year.service';
import { GeneralLedgerService } from '../../accounting-report/general-ledger.service';
import { TrialBalanceService } from '../../accounting-report/trial-balance.service';
import { FinancialStatementsService } from '../../accounting-report/financial-statements.service';
import { JournalEntryService } from '../../journal-entry/journal-entry.service';
import { GeneralLedgerQueryDto } from '../../accounting-report/dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from '../../accounting-report/dto/trial-balance-query.dto';
import { FinancialStatementQueryDto } from '../../accounting-report/dto/financial-statement-query.dto';
import { JournalEntryQueryDto } from '../../journal-entry/dto/journal-entry-query.dto';
import { AiToolDefinition, AiToolResult } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optStr, optUuid } from './tool-helpers';

/**
 * Accounting tools — reuse the existing accounting engine/reports ONLY.
 * The AI never recomputes balances; it presents trusted report outputs.
 */
@Injectable()
export class AccountingAiTools {
  constructor(
    private readonly accounts: ChartOfAccountService,
    private readonly fiscalYears: FiscalYearService,
    private readonly generalLedger: GeneralLedgerService,
    private readonly trialBalance: TrialBalanceService,
    private readonly statements: FinancialStatementsService,
    private readonly journal: JournalEntryService,
  ) {}

  /** Resolve the fiscal year to use: explicit arg, else the current one. */
  private async resolveFiscalYearId(args: Record<string, unknown>): Promise<string | AiToolResult> {
    const explicit = optUuid(args.fiscalYearId, 'fiscalYearId');
    if (explicit) return explicit;
    const current = await this.fiscalYears.findCurrent();
    if (!current) {
      return { success: false, code: 'NO_FISCAL_YEAR', message: 'لا توجد سنة مالية حالية محددة. رجاءً حدّد السنة المالية.' };
    }
    return current.id;
  }

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'search_accounts',
        description: 'ابحث في دليل الحسابات بالكود أو الاسم لإيجاد معرّف الحساب.',
        permission: 'chart_of_accounts.view',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'كود أو اسم الحساب' } },
          required: ['query'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const q = optStr(args.query);
          if (!q) return { success: false, code: 'INVALID_ARGS', message: 'اكتب اسم أو كود الحساب.' };
          const res = await this.accounts.findAll({ search: q, page: 1, perPage: 15, order: 'ASC', skip: 0 } as never);
          const rows = res.items.map((a) => ({
            id: a.id,
            code: a.accountCode,
            name: a.accountNameAr,
            type: a.accountType,
            allowPosting: a.allowPosting,
          }));
          if (!rows.length) return { success: false, code: 'ACCOUNT_NOT_FOUND', message: `لا يوجد حساب مطابق لـ "${q}".` };
          return { success: true, presentation: rows.length > 1 ? 'ambiguous' : 'table', data: { entity: 'account', results: rows } };
        },
      },
      {
        name: 'get_general_ledger',
        description: 'الأستاذ العام لحساب: الرصيد الافتتاحي والحركات والرصيد الجاري خلال فترة. يتطلب معرّف الحساب.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            accountId: { type: 'string', description: 'معرّف الحساب (uuid)' },
            fiscalYearId: { type: 'string', description: 'السنة المالية (uuid) — اختياري، الافتراضي الحالية' },
            fromDate: dateProp('من تاريخ'),
            toDate: dateProp('إلى تاريخ'),
          },
          required: ['accountId'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const accountId = optUuid(args.accountId, 'accountId');
          if (!accountId) return { success: false, code: 'INVALID_ARGS', message: 'معرّف الحساب مطلوب.' };
          const fy = await this.resolveFiscalYearId(args);
          if (typeof fy !== 'string') return fy;
          const query = {
            fiscalYearId: fy,
            accountId,
            fromDate: normalizeDate(args.fromDate, 'fromDate'),
            toDate: normalizeDate(args.toDate, 'toDate'),
            page: 1,
            perPage: 50,
            skip: 0,
          } as unknown as GeneralLedgerQueryDto;
          const report = await this.generalLedger.generate(query, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'الأستاذ العام', currency: CURRENCY, ...report } };
        },
      },
      {
        name: 'get_trial_balance',
        description: 'ميزان المراجعة: أرصدة كل الحسابات (افتتاحي/الحركة/ختامي) والتحقق من التوازن.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            fiscalYearId: { type: 'string', description: 'السنة المالية (uuid) — اختياري' },
            fromDate: dateProp('من تاريخ'),
            toDate: dateProp('إلى تاريخ'),
            branchId: { type: 'string' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const fy = await this.resolveFiscalYearId(args);
          if (typeof fy !== 'string') return fy;
          const query = {
            fiscalYearId: fy,
            fromDate: normalizeDate(args.fromDate, 'fromDate'),
            toDate: normalizeDate(args.toDate, 'toDate'),
            branchId: optUuid(args.branchId, 'branchId'),
          } as unknown as TrialBalanceQueryDto;
          const report = await this.trialBalance.generate(query, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'ميزان المراجعة', currency: CURRENCY, ...report } };
        },
      },
      {
        name: 'get_income_statement',
        description: 'قائمة الدخل (الأرباح والخسائر): الإيرادات وتكلفة المبيعات ومجمل الربح والمصروفات وصافي الربح خلال فترة.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            fiscalYearId: { type: 'string' },
            fromDate: dateProp('من تاريخ'),
            toDate: dateProp('إلى تاريخ'),
            branchId: { type: 'string' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const fy = await this.resolveFiscalYearId(args);
          if (typeof fy !== 'string') return fy;
          const query = {
            fiscalYearId: fy,
            fromDate: normalizeDate(args.fromDate, 'fromDate'),
            toDate: normalizeDate(args.toDate, 'toDate'),
            branchId: optUuid(args.branchId, 'branchId'),
          } as unknown as FinancialStatementQueryDto;
          const report = await this.statements.incomeStatement(query, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'قائمة الدخل', currency: CURRENCY, ...report } };
        },
      },
      {
        name: 'get_balance_sheet',
        description: 'الميزانية العمومية: الأصول والخصوم وحقوق الملكية حتى تاريخ معيّن.',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            fiscalYearId: { type: 'string' },
            toDate: dateProp('حتى تاريخ'),
            branchId: { type: 'string' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const fy = await this.resolveFiscalYearId(args);
          if (typeof fy !== 'string') return fy;
          const query = {
            fiscalYearId: fy,
            toDate: normalizeDate(args.toDate, 'toDate'),
            branchId: optUuid(args.branchId, 'branchId'),
          } as unknown as FinancialStatementQueryDto;
          const report = await this.statements.balanceSheet(query, ctx.branchScope);
          return { success: true, presentation: 'report', data: { title: 'الميزانية العمومية', currency: CURRENCY, ...report } };
        },
      },
      {
        name: 'get_journal_entries',
        description: 'قائمة القيود المحاسبية مع فلاتر (فترة/حالة/مصدر). مرقّمة.',
        permission: 'journal_entries.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('من تاريخ'),
            dateTo: dateProp('إلى تاريخ'),
            status: { type: 'string', description: 'draft/posted/reversed' },
            sourceType: { type: 'string', description: 'مصدر القيد' },
            branchId: { type: 'string' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            status: optStr(args.status),
            sourceType: optStr(args.sourceType),
            branchId: optUuid(args.branchId, 'branchId'),
          }) as unknown as JournalEntryQueryDto;
          const res = await this.journal.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'قيود اليومية', total: res.meta.totalItems, page: res.meta.currentPage, entries: res.items },
          };
        },
      },
    ];
  }
}
