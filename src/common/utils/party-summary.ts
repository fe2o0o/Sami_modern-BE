import { ObjectLiteral, Repository } from 'typeorm';
import { PartySummaryQueryDto } from '../dto/party-summary-query.dto';

export interface PartySummaryRow {
  id: string;
  isActive: boolean;
  creditLimit: number;
  /** Party-side balance (customer: debit − credit; supplier: credit − debit). */
  balance: number;
  periodDebit: number;
  periodCredit: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Per-party balances + period movements for every party matching the list filters
 * (search / status), computed in ONE grouped query — feeds the analysis cards.
 */
export async function partySummaryRows<T extends ObjectLiteral>(
  repo: Repository<T>,
  opts: {
    txEntity: new () => ObjectLiteral;
    fk: string;
    searchFields: string[];
    sign: 1 | -1;
    withCreditLimit: boolean;
  },
  query: PartySummaryQueryDto,
): Promise<PartySummaryRow[]> {
  const qb = repo
    .createQueryBuilder('p')
    .select('p.id', 'id')
    .addSelect('p.isActive', 'active')
    .leftJoin(opts.txEntity, 't', `t.${opts.fk} = p.id AND t.deletedAt IS NULL`)
    .addSelect('COALESCE(SUM(t.debit), 0)', 'd')
    .addSelect('COALESCE(SUM(t.credit), 0)', 'c')
    .groupBy('p.id')
    .addGroupBy('p.isActive');
  if (opts.withCreditLimit) qb.addSelect('p.creditLimit', 'lim').addGroupBy('p.creditLimit');

  const from = query.dateFrom ?? '0000-01-01';
  const to = query.dateTo ?? '9999-12-31';
  qb.addSelect('COALESCE(SUM(CASE WHEN t.transactionDate BETWEEN :pf AND :pt THEN t.debit ELSE 0 END), 0)', 'pd')
    .addSelect('COALESCE(SUM(CASE WHEN t.transactionDate BETWEEN :pf AND :pt THEN t.credit ELSE 0 END), 0)', 'pc')
    .setParameters({ pf: from, pt: to });

  if (query.search && opts.searchFields.length) {
    qb.andWhere(`(${opts.searchFields.map((f) => `p.${f} LIKE :s`).join(' OR ')})`, { s: `%${query.search}%` });
  }
  if (query.isActive !== undefined) qb.andWhere('p.isActive = :active', { active: query.isActive });

  const raw = await qb.getRawMany<{ id: string; active: number | boolean; d: string; c: string; pd: string; pc: string; lim?: string }>();
  return raw.map((r) => ({
    id: r.id,
    isActive: r.active === true || Number(r.active) === 1,
    creditLimit: Number(r.lim ?? 0) || 0,
    balance: r2(opts.sign * (Number(r.d) - Number(r.c))),
    periodDebit: r2(Number(r.pd)),
    periodCredit: r2(Number(r.pc)),
  }));
}

/** Aggregate the rows into the card figures. */
export function summarizeParties(rows: PartySummaryRow[], query: PartySummaryQueryDto) {
  const sum = (f: (r: PartySummaryRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return {
    period: { from: query.dateFrom ?? null, to: query.dateTo ?? null },
    count: rows.length,
    activeCount: rows.filter((r) => r.isActive).length,
    withBalanceCount: rows.filter((r) => r.balance > 0.004).length,
    /** Σ positive balances (owed to us by customers / owed by us to suppliers). */
    outstanding: sum((r) => (r.balance > 0 ? r.balance : 0)),
    /** Σ negative balances as a positive number (advances / credit balances). */
    advances: sum((r) => (r.balance < 0 ? -r.balance : 0)),
    netBalance: sum((r) => r.balance),
    overLimitCount: rows.filter((r) => r.creditLimit > 0 && r.balance > r.creditLimit).length,
    periodDebit: sum((r) => r.periodDebit),
    periodCredit: sum((r) => r.periodCredit),
  };
}
