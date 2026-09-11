import { Injectable } from '@nestjs/common';
import { applyBranchScope } from "../../common/utils/branch-scope.util";
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { AccountSubType, AccountType } from '../chart-of-account/enums/account.enum';
import { FinancialStatementQueryDto } from './dto/financial-statement-query.dto';
import { round2, MONEY_TOLERANCE } from './ledger-math';
import { resolveReportRange } from './report-range.util';

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface StatementSection {
  lines: StatementLine[];
  total: number;
}

export interface IncomeStatement {
  period: { from: string; to: string };
  revenues: StatementSection;
  cogs: StatementSection;
  grossProfit: number;
  expenses: StatementSection;
  netProfit: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  netIncome: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  isBalanced: boolean;
}

interface Agg {
  debit: number;
  credit: number;
}

/**
 * Income Statement + Balance Sheet — READ-ONLY, computed from ledger-affecting
 * journal lines (`je.isPosted = true`). The Income Statement nets REVENUE and
 * EXPENSE accounts over a period; the Balance Sheet nets ASSET/LIABILITY/EQUITY
 * cumulatively up to a date and folds the period's net income into equity so it
 * balances (income accounts are not periodically closed to retained earnings).
 */
@Injectable()
export class FinancialStatementsService {
  constructor(
    @InjectRepository(JournalEntryLine)
    private readonly lineRepository: Repository<JournalEntryLine>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
  ) {}

  // =========================================================
  // INCOME STATEMENT
  // =========================================================
  async incomeStatement(
    query: FinancialStatementQueryDto,
    branchScope: string[] | null = null,
  ): Promise<IncomeStatement> {
    query.branchScope = branchScope;
    const { from, to } = await resolveReportRange(this.fiscalYearRepository, this.periodRepository, query);
    const byAccount = await this.aggregate(query, (qb) =>
      qb.andWhere('je.entryDate >= :from', { from }).andWhere('je.entryDate <= :to', { to }),
    );
    const accounts = await this.loadAccounts([...byAccount.keys()]);

    const revenues: StatementLine[] = [];
    const cogs: StatementLine[] = [];
    const expenses: StatementLine[] = [];

    for (const account of accounts) {
      const agg = byAccount.get(account.id)!;
      if (account.accountType === AccountType.REVENUE) {
        const amount = round2(agg.credit - agg.debit); // credit-normal
        if (Math.abs(amount) >= MONEY_TOLERANCE) {
          revenues.push(this.line(account, amount));
        }
      } else if (account.accountType === AccountType.EXPENSE) {
        const amount = round2(agg.debit - agg.credit); // debit-normal
        if (Math.abs(amount) < MONEY_TOLERANCE) continue;
        if (account.accountSubType === AccountSubType.COGS) cogs.push(this.line(account, amount));
        else expenses.push(this.line(account, amount));
      }
    }

    const revenueTotal = this.sum(revenues);
    const cogsTotal = this.sum(cogs);
    const expensesTotal = this.sum(expenses);
    const grossProfit = round2(revenueTotal - cogsTotal);
    const netProfit = round2(grossProfit - expensesTotal);

    return {
      period: { from, to },
      revenues: { lines: revenues, total: revenueTotal },
      cogs: { lines: cogs, total: cogsTotal },
      grossProfit,
      expenses: { lines: expenses, total: expensesTotal },
      netProfit,
    };
  }

  // =========================================================
  // BALANCE SHEET
  // =========================================================
  async balanceSheet(
    query: FinancialStatementQueryDto,
    branchScope: string[] | null = null,
  ): Promise<BalanceSheet> {
    query.branchScope = branchScope;
    const { to } = await resolveReportRange(this.fiscalYearRepository, this.periodRepository, query);
    // Cumulative: everything up to and including the as-of date.
    const byAccount = await this.aggregate(query, (qb) => qb.andWhere('je.entryDate <= :to', { to }));
    const accounts = await this.loadAccounts([...byAccount.keys()]);

    const assets: StatementLine[] = [];
    const liabilities: StatementLine[] = [];
    const equity: StatementLine[] = [];
    let revenueNet = 0;
    let expenseNet = 0;

    for (const account of accounts) {
      const agg = byAccount.get(account.id)!;
      switch (account.accountType) {
        case AccountType.ASSET: {
          const amount = round2(agg.debit - agg.credit);
          if (Math.abs(amount) >= MONEY_TOLERANCE) assets.push(this.line(account, amount));
          break;
        }
        case AccountType.LIABILITY: {
          const amount = round2(agg.credit - agg.debit);
          if (Math.abs(amount) >= MONEY_TOLERANCE) liabilities.push(this.line(account, amount));
          break;
        }
        case AccountType.EQUITY: {
          const amount = round2(agg.credit - agg.debit);
          if (Math.abs(amount) >= MONEY_TOLERANCE) equity.push(this.line(account, amount));
          break;
        }
        case AccountType.REVENUE:
          revenueNet = round2(revenueNet + (agg.credit - agg.debit));
          break;
        case AccountType.EXPENSE:
          expenseNet = round2(expenseNet + (agg.debit - agg.credit));
          break;
      }
    }

    // Net income for the period folds into equity (unclosed income accounts).
    const netIncome = round2(revenueNet - expenseNet);
    if (Math.abs(netIncome) >= MONEY_TOLERANCE) {
      equity.push({ accountId: 'net-income', code: '', name: 'صافي ربح/خسارة الفترة', amount: netIncome });
    }

    const totalAssets = this.sum(assets);
    const totalLiabilities = this.sum(liabilities);
    const totalEquity = this.sum(equity);
    const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
    const difference = round2(totalAssets - totalLiabilitiesAndEquity);

    return {
      asOf: to,
      assets: { lines: assets, total: totalAssets },
      liabilities: { lines: liabilities, total: totalLiabilities },
      equity: { lines: equity, total: totalEquity },
      netIncome,
      totalAssets,
      totalLiabilitiesAndEquity,
      difference,
      isBalanced: Math.abs(difference) < MONEY_TOLERANCE,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private line(account: ChartOfAccount, amount: number): StatementLine {
    return { accountId: account.id, code: account.accountCode, name: account.accountNameAr, amount };
  }
  private sum(lines: StatementLine[]): number {
    return round2(lines.reduce((s, l) => s + l.amount, 0));
  }

  private async loadAccounts(ids: string[]): Promise<ChartOfAccount[]> {
    if (!ids.length) return [];
    const rows = await this.accountRepository.find({ where: { id: In(ids) } });
    rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return rows;
  }

  /** Σdebit/Σcredit grouped by account, POSTED lines only, plus the caller's window. */
  private async aggregate(
    query: FinancialStatementQueryDto,
    window: (qb: SelectQueryBuilder<JournalEntryLine>) => SelectQueryBuilder<JournalEntryLine>,
  ): Promise<Map<string, Agg>> {
    const qb = this.lineRepository
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .select('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'c')
      .where('je.isPosted = :posted', { posted: true })
      .groupBy('l.accountId');
    if (query.branchId) qb.andWhere('l.branchId = :branchId', { branchId: query.branchId });
    applyBranchScope(qb, 'l.branchId', query.branchScope ?? null);

    const rows = await window(qb).getRawMany<{ accountId: string; d: string; c: string }>();
    return new Map(rows.map((r): [string, Agg] => [r.accountId, { debit: round2(Number(r.d)), credit: round2(Number(r.c)) }]));
  }
}
