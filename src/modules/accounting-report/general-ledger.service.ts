import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { PaginationMeta } from '../../common/interfaces/api-response.interface';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { BalanceSide, round2, runningBalances, sideOf } from './ledger-math';
import { resolveReportRange } from './report-range.util';

export interface GeneralLedgerMovement {
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  description: string | null;
  sourceType: string;
  sourceNumber: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  runningBalanceSide: BalanceSide;
}

export interface GeneralLedgerReport {
  account: {
    id: string;
    code: string;
    name: string;
    accountType: string;
    accountNature: string;
  };
  period: { from: string; to: string };
  openingBalance: { amount: number; side: BalanceSide };
  movements: GeneralLedgerMovement[];
  totals: {
    debit: number;
    credit: number;
    closingBalance: number;
    closingBalanceSide: BalanceSide;
  };
  pagination: PaginationMeta;
}

/**
 * General Ledger — a READ-ONLY account statement derived entirely from journal
 * lines that affect the ledger (`je.isPosted = true`, which covers both POSTED
 * entries AND reversed originals — a reversed entry and its reversal both stay
 * in history and net to zero). Never writes accounting data. All arithmetic is
 * done in SQL
 * (no loading every line into Node), and the running balance is seeded with the
 * balance brought forward from earlier pages so it stays correct under
 * pagination.
 */
@Injectable()
export class GeneralLedgerService {
  constructor(
    @InjectRepository(JournalEntryLine)
    private readonly lineRepository: Repository<JournalEntryLine>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    private readonly dataSource: DataSource,
  ) {}

  async generate(query: GeneralLedgerQueryDto): Promise<GeneralLedgerReport> {
    const account = await this.accountRepository.findOne({
      where: { id: query.accountId },
    });
    if (!account) {
      throw new NotFoundException('الحساب غير موجود');
    }

    const { from, to } = await this.resolveRange(query);

    // Opening: cumulative net of every posted movement BEFORE the range start.
    const openingNet = await this.openingNet(query, from);

    // Grand totals + count over the whole range (SQL aggregate — not per page).
    const totalsRow = await this.movementsQb(query, from, to)
      .select('COALESCE(SUM(l.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'c')
      .getRawOne<{ d: string; c: string }>();
    const totalDebit = round2(Number(totalsRow?.d ?? 0));
    const totalCredit = round2(Number(totalsRow?.c ?? 0));

    const total = await this.movementsQb(query, from, to).getCount();

    // Balance brought forward to the top of THIS page = opening + Σ(net) of all
    // rows ranked before the page's first row (same order, LIMIT = skip).
    const broughtForwardNet = await this.broughtForwardNet(
      query,
      from,
      to,
      openingNet,
    );

    const rows = await this.movementsQb(query, from, to)
      .select('je.id', 'journalEntryId')
      .addSelect('je.entryNumber', 'entryNumber')
      .addSelect('je.entryDate', 'entryDate')
      .addSelect('je.description', 'entryDescription')
      .addSelect('je.sourceType', 'sourceType')
      .addSelect('je.sourceNumber', 'sourceNumber')
      .addSelect('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .addSelect('l.description', 'lineDescription')
      .orderBy('je.entryDate', 'ASC')
      .addOrderBy('je.entryNumber', 'ASC')
      .addOrderBy('l.lineNumber', 'ASC')
      .offset(query.skip)
      .limit(query.perPage)
      .getRawMany<{
        journalEntryId: string;
        entryNumber: string | null;
        entryDate: string;
        entryDescription: string | null;
        sourceType: string;
        sourceNumber: string | null;
        debit: string;
        credit: string;
        lineDescription: string | null;
      }>();

    const running = runningBalances(
      broughtForwardNet,
      rows.map((r) => ({ debit: Number(r.debit), credit: Number(r.credit) })),
    );

    const movements: GeneralLedgerMovement[] = rows.map((r, i) => ({
      journalEntryId: r.journalEntryId,
      entryNumber: r.entryNumber,
      date: r.entryDate,
      description: r.lineDescription || r.entryDescription,
      sourceType: r.sourceType,
      sourceNumber: r.sourceNumber,
      debit: round2(Number(r.debit)),
      credit: round2(Number(r.credit)),
      runningBalance: running[i].runningBalance,
      runningBalanceSide: running[i].runningBalanceSide,
    }));

    const closingNet = round2(openingNet + totalDebit - totalCredit);

    return {
      account: {
        id: account.id,
        code: account.accountCode,
        name: account.accountNameAr,
        accountType: account.accountType,
        accountNature: account.accountNature,
      },
      period: { from, to },
      openingBalance: { amount: round2(Math.abs(openingNet)), side: sideOf(openingNet) },
      movements,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        closingBalance: round2(Math.abs(closingNet)),
        closingBalanceSide: sideOf(closingNet),
      },
      pagination: buildPaginationMeta(total, query.page, query.perPage),
    };
  }

  // =========================================================
  // QUERY BUILDING
  // =========================================================
  /** Movements for the account inside [from, to], honouring branch/source. */
  private movementsQb(
    query: GeneralLedgerQueryDto,
    from: string,
    to: string,
  ): SelectQueryBuilder<JournalEntryLine> {
    const qb = this.lineRepository
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .where('je.isPosted = :posted', { posted: true })
      .andWhere('l.accountId = :accountId', { accountId: query.accountId })
      .andWhere('je.entryDate >= :from', { from })
      .andWhere('je.entryDate <= :to', { to });

    if (query.branchId) {
      qb.andWhere('l.branchId = :branchId', { branchId: query.branchId });
    }
    if (query.sourceType) {
      qb.andWhere('je.sourceType = :sourceType', { sourceType: query.sourceType });
    }
    return qb;
  }

  /** Σdebit − Σcredit for the account across all posted lines before `from`. */
  private async openingNet(
    query: GeneralLedgerQueryDto,
    from: string,
  ): Promise<number> {
    const qb = this.lineRepository
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .select('COALESCE(SUM(l.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'c')
      .where('je.isPosted = :posted', { posted: true })
      .andWhere('l.accountId = :accountId', { accountId: query.accountId })
      .andWhere('je.entryDate < :from', { from });

    if (query.branchId) {
      qb.andWhere('l.branchId = :branchId', { branchId: query.branchId });
    }

    const row = await qb.getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.d ?? 0) - Number(row?.c ?? 0));
  }

  /**
   * openingNet + Σ(debit − credit) of the movements ranked before the requested
   * page (same ordering, LIMIT = skip). Keeps the running balance continuous
   * across pages instead of restarting at zero.
   */
  private async broughtForwardNet(
    query: GeneralLedgerQueryDto,
    from: string,
    to: string,
    openingNet: number,
  ): Promise<number> {
    if (query.skip <= 0) return openingNet;

    const inner = this.movementsQb(query, from, to)
      .select('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .orderBy('je.entryDate', 'ASC')
      .addOrderBy('je.entryNumber', 'ASC')
      .addOrderBy('l.lineNumber', 'ASC')
      .limit(query.skip);

    const row = await this.dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(t.debit - t.credit), 0)', 'net')
      .from('(' + inner.getQuery() + ')', 't')
      .setParameters(inner.getParameters())
      .getRawOne<{ net: string }>();

    return round2(openingNet + Number(row?.net ?? 0));
  }

  private resolveRange(
    query: GeneralLedgerQueryDto,
  ): Promise<{ from: string; to: string }> {
    return resolveReportRange(
      this.fiscalYearRepository,
      this.periodRepository,
      query,
    );
  }
}
