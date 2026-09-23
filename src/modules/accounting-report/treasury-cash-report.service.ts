import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { applyBranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { Treasury } from '../treasury/entities/treasury.entity';
import { TreasuryTransaction } from '../treasury/entities/treasury-transaction.entity';
import { TREASURY_TRANSACTION_TYPE_LABELS } from '../treasury/enums/treasury-transaction.enum';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { BankTransaction } from '../bank-account/entities/bank-transaction.entity';
import { BANK_TRANSACTION_TYPE_LABELS } from '../bank-account/enums/bank-transaction.enum';
import { CashAccountsReportQueryDto } from './dto/cash-accounts-report-query.dto';
import { round2 } from './ledger-math';

/** Widest date bounds → an omitted filter never clips the data. */
const MIN_DATE = '0001-01-01';
const MAX_DATE = '9999-12-31';

export type CashAccountKind = 'treasury' | 'bank';

export interface CashAccountSummaryRow {
  id: string;
  kind: CashAccountKind;
  code: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
}

export interface CashAccountsSummary {
  period: { from: string | null; to: string | null };
  rows: CashAccountSummaryRow[];
  totals: { opening: number; totalIn: number; totalOut: number; closing: number };
}

export interface CashStatementMovement {
  date: string;
  type: string;
  sourceNumber: string | null;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface CashAccountStatement {
  account: { id: string; kind: CashAccountKind; code: string; name: string; branchName: string | null };
  period: { from: string | null; to: string | null };
  openingBalance: number;
  movements: CashStatementMovement[];
  totals: { totalIn: number; totalOut: number; closingBalance: number };
}

/**
 * Treasury / Cash-accounts report — READ-ONLY, derived from the treasury & bank
 * operational subledgers (not the GL). Branch scoping is enforced: treasuries by
 * their single `branchId`; bank accounts by the many-to-many link where an empty
 * link set means "available to all branches".
 */
@Injectable()
export class TreasuryCashReportService {
  constructor(
    @InjectRepository(Treasury)
    private readonly treasuryRepo: Repository<Treasury>,
    @InjectRepository(TreasuryTransaction)
    private readonly treasuryTxRepo: Repository<TreasuryTransaction>,
    @InjectRepository(BankAccount)
    private readonly bankRepo: Repository<BankAccount>,
    @InjectRepository(BankTransaction)
    private readonly bankTxRepo: Repository<BankTransaction>,
  ) {}

  // =========================================================
  // SUMMARY (all treasuries + bank accounts in scope)
  // =========================================================
  async summary(
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null = null,
  ): Promise<CashAccountsSummary> {
    const from = query.fromDate ?? MIN_DATE;
    const to = query.toDate ?? MAX_DATE;

    const treasuries = await this.treasurySummaryRows(query, branchScope, from, to);
    const banks = await this.bankSummaryRows(query, branchScope, from, to);
    const rows = [...treasuries, ...banks].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const totals = rows.reduce(
      (acc, r) => ({
        opening: round2(acc.opening + r.opening),
        totalIn: round2(acc.totalIn + r.totalIn),
        totalOut: round2(acc.totalOut + r.totalOut),
        closing: round2(acc.closing + r.closing),
      }),
      { opening: 0, totalIn: 0, totalOut: 0, closing: 0 },
    );

    return {
      period: { from: query.fromDate ?? null, to: query.toDate ?? null },
      rows,
      totals,
    };
  }

  private async treasurySummaryRows(
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null,
    from: string,
    to: string,
  ): Promise<CashAccountSummaryRow[]> {
    const qb = this.treasuryRepo
      .createQueryBuilder('tr')
      .leftJoin('tr.branch', 'branch')
      .leftJoin(TreasuryTransaction, 'tx', 'tx.treasuryId = tr.id')
      .select('tr.id', 'id')
      .addSelect('tr.code', 'code')
      .addSelect('tr.name', 'name')
      .addSelect('tr.branchId', 'branchId')
      .addSelect('branch.name', 'branchName')
      .addSelect(this.openingExpr('tx'), 'opening')
      .addSelect(this.inExpr('tx'), 'totalIn')
      .addSelect(this.outExpr('tx'), 'totalOut')
      .where('tr.isActive = :active', { active: true })
      .groupBy('tr.id')
      .addGroupBy('tr.code')
      .addGroupBy('tr.name')
      .addGroupBy('tr.branchId')
      .addGroupBy('branch.name')
      .setParameters({ from, to });

    applyBranchScope(qb, 'tr.branchId', branchScope);
    if (query.branchId) qb.andWhere('tr.branchId = :branchId', { branchId: query.branchId });

    const raw = await qb.getRawMany<RawSummary>();
    return raw.map((r) => this.toSummaryRow(r, 'treasury'));
  }

  private async bankSummaryRows(
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null,
    from: string,
    to: string,
  ): Promise<CashAccountSummaryRow[]> {
    const qb = this.bankRepo
      .createQueryBuilder('b')
      .leftJoin(BankTransaction, 'tx', 'tx.bankAccountId = b.id')
      .select('b.id', 'id')
      .addSelect('b.code', 'code')
      .addSelect("CONCAT(b.bankName, ' — ', b.accountName)", 'name')
      .addSelect(this.openingExpr('tx'), 'opening')
      .addSelect(this.inExpr('tx'), 'totalIn')
      .addSelect(this.outExpr('tx'), 'totalOut')
      .where('b.isActive = :active', { active: true })
      .groupBy('b.id')
      .addGroupBy('b.code')
      .addGroupBy('b.bankName')
      .addGroupBy('b.accountName')
      .setParameters({ from, to });

    this.applyBankBranchScope(qb, branchScope, query.branchId);

    const raw = await qb.getRawMany<RawSummary>();
    return raw.map((r) => ({ ...this.toSummaryRow(r, 'bank'), branchId: null, branchName: 'مشترك / كل الفروع' }));
  }

  // =========================================================
  // STATEMENT (one treasury or bank account)
  // =========================================================
  async statement(
    kind: CashAccountKind,
    id: string,
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null = null,
  ): Promise<CashAccountStatement> {
    const from = query.fromDate ?? MIN_DATE;
    const to = query.toDate ?? MAX_DATE;

    return kind === 'treasury'
      ? this.treasuryStatement(id, query, branchScope, from, to)
      : this.bankStatement(id, query, branchScope, from, to);
  }

  private async treasuryStatement(
    id: string,
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null,
    from: string,
    to: string,
  ): Promise<CashAccountStatement> {
    const treasury = await this.treasuryRepo.findOne({ where: { id }, relations: { branch: true } });
    if (!treasury) throw new NotFoundException('الخزينة غير موجودة');
    if (!isWithinBranchScope(treasury.branchId, branchScope)) {
      throw new ForbiddenException('لا تملك صلاحية على هذه الخزينة');
    }

    const opening = await this.openingBalance(this.treasuryTxRepo, 'treasuryId', id, from);
    const rows = await this.treasuryTxRepo
      .createQueryBuilder('tx')
      .where('tx.treasuryId = :id', { id })
      .andWhere('tx.transactionDate >= :from', { from })
      .andWhere('tx.transactionDate <= :to', { to })
      .orderBy('tx.transactionDate', 'ASC')
      .addOrderBy('tx.createdAt', 'ASC')
      .getMany();

    const movements = this.buildMovements(
      rows.map((r) => ({
        date: r.transactionDate,
        type: TREASURY_TRANSACTION_TYPE_LABELS[r.type] ?? r.type,
        sourceNumber: r.sourceNumber,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
      })),
      opening,
    );

    return this.assembleStatement(
      { id: treasury.id, kind: 'treasury', code: treasury.code, name: treasury.name, branchName: treasury.branch?.name ?? null },
      query,
      opening,
      movements,
    );
  }

  private async bankStatement(
    id: string,
    query: CashAccountsReportQueryDto,
    branchScope: string[] | null,
    from: string,
    to: string,
  ): Promise<CashAccountStatement> {
    const bank = await this.bankRepo.findOne({ where: { id }, relations: { branches: true } });
    if (!bank) throw new NotFoundException('الحساب البنكي غير موجود');
    if (!this.bankWithinScope(bank, branchScope)) {
      throw new ForbiddenException('لا تملك صلاحية على هذا الحساب البنكي');
    }

    const opening = await this.openingBalance(this.bankTxRepo, 'bankAccountId', id, from);
    const rows = await this.bankTxRepo
      .createQueryBuilder('tx')
      .where('tx.bankAccountId = :id', { id })
      .andWhere('tx.transactionDate >= :from', { from })
      .andWhere('tx.transactionDate <= :to', { to })
      .orderBy('tx.transactionDate', 'ASC')
      .addOrderBy('tx.createdAt', 'ASC')
      .getMany();

    const movements = this.buildMovements(
      rows.map((r) => ({
        date: r.transactionDate,
        type: BANK_TRANSACTION_TYPE_LABELS[r.type] ?? r.type,
        sourceNumber: r.sourceNumber,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
      })),
      opening,
    );

    return this.assembleStatement(
      { id: bank.id, kind: 'bank', code: bank.code, name: `${bank.bankName} — ${bank.accountName}`, branchName: 'مشترك / كل الفروع' },
      query,
      opening,
      movements,
    );
  }

  // =========================================================
  // HELPERS
  // =========================================================
  /** debit = cash in; credit = cash out. Net before the range = opening. */
  private openingExpr(alias: string): string {
    return `COALESCE(SUM(CASE WHEN ${alias}.transactionDate < :from THEN ${alias}.debit - ${alias}.credit ELSE 0 END), 0)`;
  }
  private inExpr(alias: string): string {
    return `COALESCE(SUM(CASE WHEN ${alias}.transactionDate >= :from AND ${alias}.transactionDate <= :to THEN ${alias}.debit ELSE 0 END), 0)`;
  }
  private outExpr(alias: string): string {
    return `COALESCE(SUM(CASE WHEN ${alias}.transactionDate >= :from AND ${alias}.transactionDate <= :to THEN ${alias}.credit ELSE 0 END), 0)`;
  }

  private toSummaryRow(r: RawSummary, kind: CashAccountKind): CashAccountSummaryRow {
    const opening = round2(Number(r.opening ?? 0));
    const totalIn = round2(Number(r.totalIn ?? 0));
    const totalOut = round2(Number(r.totalOut ?? 0));
    return {
      id: r.id,
      kind,
      code: r.code,
      name: r.name,
      branchId: r.branchId ?? null,
      branchName: r.branchName ?? null,
      opening,
      totalIn,
      totalOut,
      closing: round2(opening + totalIn - totalOut),
    };
  }

  /** Σ(debit − credit) for a subledger account strictly before `from`. */
  private async openingBalance(
    repo: Repository<TreasuryTransaction | BankTransaction>,
    fk: 'treasuryId' | 'bankAccountId',
    id: string,
    from: string,
  ): Promise<number> {
    const row = await repo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(tx.credit), 0)', 'c')
      .where(`tx.${fk} = :id`, { id })
      .andWhere('tx.transactionDate < :from', { from })
      .getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.d ?? 0) - Number(row?.c ?? 0));
  }

  private buildMovements(
    rows: { date: string; type: string; sourceNumber: string | null; description: string | null; debit: number; credit: number }[],
    opening: number,
  ): CashStatementMovement[] {
    let running = opening;
    return rows.map((r) => {
      running = round2(running + r.debit - r.credit);
      return {
        date: r.date,
        type: r.type,
        sourceNumber: r.sourceNumber,
        description: r.description,
        debit: round2(r.debit),
        credit: round2(r.credit),
        runningBalance: running,
      };
    });
  }

  private assembleStatement(
    account: CashAccountStatement['account'],
    query: CashAccountsReportQueryDto,
    opening: number,
    movements: CashStatementMovement[],
  ): CashAccountStatement {
    const totalIn = round2(movements.reduce((s, m) => s + m.debit, 0));
    const totalOut = round2(movements.reduce((s, m) => s + m.credit, 0));
    return {
      account,
      period: { from: query.fromDate ?? null, to: query.toDate ?? null },
      openingBalance: opening,
      movements,
      totals: { totalIn, totalOut, closingBalance: round2(opening + totalIn - totalOut) },
    };
  }

  // ── Bank branch scoping (many-to-many; empty link set = all branches) ──
  private applyBankBranchScope(
    qb: SelectQueryBuilder<BankAccount>,
    scope: string[] | null,
    branchId?: string,
  ): void {
    if (scope !== null) {
      if (scope.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere(
          `(EXISTS (SELECT 1 FROM bank_account_branches bab WHERE bab.bank_account_id = b.id AND bab.branch_id IN (:...scopeIds))
            OR NOT EXISTS (SELECT 1 FROM bank_account_branches babx WHERE babx.bank_account_id = b.id))`,
          { scopeIds: scope },
        );
      }
    }
    if (branchId) {
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM bank_account_branches babf WHERE babf.bank_account_id = b.id AND babf.branch_id = :bId)
          OR NOT EXISTS (SELECT 1 FROM bank_account_branches babfx WHERE babfx.bank_account_id = b.id))`,
        { bId: branchId },
      );
    }
  }

  private bankWithinScope(bank: BankAccount, scope: string[] | null): boolean {
    if (scope === null) return true;
    const links = (bank.branches ?? []).map((br) => br.id);
    if (links.length === 0) return true; // central account = all branches
    return links.some((id) => scope.includes(id));
  }
}

interface RawSummary {
  id: string;
  code: string;
  name: string;
  branchId?: string | null;
  branchName?: string | null;
  opening: string;
  totalIn: string;
  totalOut: string;
}
