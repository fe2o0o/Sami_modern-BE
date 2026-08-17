import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { round2, splitNet, MONEY_TOLERANCE } from './ledger-math';
import { resolveReportRange } from './report-range.util';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalanceReport {
  period: { from: string; to: string };
  accounts: TrialBalanceRow[];
  totals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
    difference: number;
    isBalanced: boolean;
  };
}

interface AccountAgg {
  openingNet: number;
  periodDebit: number;
  periodCredit: number;
}

/**
 * Trial Balance — a READ-ONLY snapshot of every account's opening balance,
 * period movement and closing balance, computed from ledger-affecting journal
 * lines (`je.isPosted = true` — POSTED entries plus reversed originals, so a
 * reversal and its original both count and net to zero) via two grouped SQL
 * aggregations (opening before the range, movement inside it).
 * Never writes accounting data. Also verifies that total debits equal total
 * credits and surfaces any difference instead of hiding it.
 */
@Injectable()
export class TrialBalanceService {
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

  async generate(query: TrialBalanceQueryDto): Promise<TrialBalanceReport> {
    const { from, to } = await resolveReportRange(
      this.fiscalYearRepository,
      this.periodRepository,
      query,
    );

    // Opening: everything strictly before the range. Period: inside the range.
    const [openingRows, periodRows] = await Promise.all([
      this.aggregate(query, (qb) => qb.andWhere('je.entryDate < :from', { from })),
      this.aggregate(query, (qb) =>
        qb
          .andWhere('je.entryDate >= :from', { from })
          .andWhere('je.entryDate <= :to', { to }),
      ),
    ]);

    // Merge both aggregations per account.
    const byAccount = new Map<string, AccountAgg>();
    const ensure = (id: string): AccountAgg => {
      let agg = byAccount.get(id);
      if (!agg) {
        agg = { openingNet: 0, periodDebit: 0, periodCredit: 0 };
        byAccount.set(id, agg);
      }
      return agg;
    };
    for (const r of openingRows) {
      ensure(r.accountId).openingNet = round2(Number(r.d) - Number(r.c));
    }
    for (const r of periodRows) {
      const agg = ensure(r.accountId);
      agg.periodDebit = round2(Number(r.d));
      agg.periodCredit = round2(Number(r.c));
    }

    // Join with the chart of accounts (optionally filtered by type).
    const ids = [...byAccount.keys()];
    const accounts = ids.length
      ? await this.accountRepository.find({
          where: query.accountType
            ? { id: In(ids), accountType: query.accountType }
            : { id: In(ids) },
        })
      : [];
    accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const rows: TrialBalanceRow[] = [];
    for (const account of accounts) {
      const agg = byAccount.get(account.id)!;
      const opening = splitNet(agg.openingNet);
      const closingNet = round2(
        agg.openingNet + agg.periodDebit - agg.periodCredit,
      );
      const closing = splitNet(closingNet);

      const isAllZero =
        Math.abs(agg.openingNet) < MONEY_TOLERANCE &&
        agg.periodDebit < MONEY_TOLERANCE &&
        agg.periodCredit < MONEY_TOLERANCE;
      if (isAllZero && !query.includeZeroBalances) continue;

      rows.push({
        accountId: account.id,
        code: account.accountCode,
        name: account.accountNameAr,
        accountType: account.accountType,
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        periodDebit: agg.periodDebit,
        periodCredit: agg.periodCredit,
        closingDebit: closing.debit,
        closingCredit: closing.credit,
      });
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.openingDebit = round2(acc.openingDebit + r.openingDebit);
        acc.openingCredit = round2(acc.openingCredit + r.openingCredit);
        acc.periodDebit = round2(acc.periodDebit + r.periodDebit);
        acc.periodCredit = round2(acc.periodCredit + r.periodCredit);
        acc.closingDebit = round2(acc.closingDebit + r.closingDebit);
        acc.closingCredit = round2(acc.closingCredit + r.closingCredit);
        return acc;
      },
      {
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: 0,
        closingDebit: 0,
        closingCredit: 0,
      },
    );

    const difference = round2(totals.closingDebit - totals.closingCredit);

    return {
      period: { from, to },
      accounts: rows,
      totals: {
        ...totals,
        difference,
        isBalanced: Math.abs(difference) < MONEY_TOLERANCE,
      },
    };
  }

  /** Σdebit/Σcredit grouped by account, POSTED only, plus the caller's window. */
  private aggregate(
    query: TrialBalanceQueryDto,
    window: (
      qb: SelectQueryBuilder<JournalEntryLine>,
    ) => SelectQueryBuilder<JournalEntryLine>,
  ): Promise<Array<{ accountId: string; d: string; c: string }>> {
    const qb = this.lineRepository
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .select('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'c')
      .where('je.isPosted = :posted', { posted: true })
      .groupBy('l.accountId');

    if (query.branchId) {
      qb.andWhere('l.branchId = :branchId', { branchId: query.branchId });
    }

    return window(qb).getRawMany<{ accountId: string; d: string; c: string }>();
  }
}
