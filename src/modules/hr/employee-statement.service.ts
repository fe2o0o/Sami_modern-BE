import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BranchScope, applyBranchScope } from '../../common/utils/branch-scope.util';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeAdvanceInstallment } from './entities/employee-advance.entity';
import { InstallmentStatus } from './enums/advance.enum';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const toYmd = (v: unknown): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${`${v.getMonth() + 1}`.padStart(2, '0')}-${`${v.getDate()}`.padStart(2, '0')}`;
  return String(v ?? '').slice(0, 10);
};

export type EmployeeAccountKind = 'advances' | 'custody' | 'other';

/**
 * Employee statement & balances, read straight from POSTED journal lines that
 * carry the employee on an employee account (advances / custody from the
 * settings, plus any account flagged «requiresEmployee» — e.g. manual entries
 * on an older «العهد والسلف» account). Positive balance = the employee owes.
 */
@Injectable()
export class EmployeeStatementService {
  constructor(private readonly dataSource: DataSource) {}

  private async employeeAccounts() {
    const settings = await this.dataSource.getRepository(AccountingSetting).findOne({ where: {} });
    const flagged = await this.dataSource.getRepository(ChartOfAccount).find({ where: { requiresEmployee: true }, withDeleted: true });
    const ids = new Set(flagged.map((a) => a.id));
    if (settings?.employeeAdvancesAccountId) ids.add(settings.employeeAdvancesAccountId);
    if (settings?.employeeCustodyAccountId) ids.add(settings.employeeCustodyAccountId);
    const accounts = ids.size ? await this.dataSource.getRepository(ChartOfAccount).find({ where: [...ids].map((id) => ({ id })), withDeleted: true }) : [];
    const kind = (id: string): EmployeeAccountKind =>
      id === settings?.employeeAdvancesAccountId ? 'advances' : id === settings?.employeeCustodyAccountId ? 'custody' : 'other';
    return { ids: [...ids], info: new Map(accounts.map((a) => [a.id, { name: `${a.accountCode} - ${a.accountNameAr}`, kind: kind(a.id) }])) };
  }

  async statement(employeeId: string, q: { dateFrom?: string; dateTo?: string }) {
    const employee = await this.dataSource.getRepository(Employee).findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('لم يتم العثور على الموظف');
    const { ids, info } = await this.employeeAccounts();
    const empty = { balances: [] as { accountId: string; accountName: string; kind: EmployeeAccountKind; balance: number }[], total: 0, opening: 0, rows: [] as unknown[] };
    if (!ids.length) return empty;

    const base = () =>
      this.dataSource
        .getRepository(JournalEntryLine)
        .createQueryBuilder('l')
        .innerJoin('l.journalEntry', 'je')
        .where('je.isPosted = 1')
        .andWhere('l.employeeId = :e', { e: employeeId })
        .andWhere('l.accountId IN (:...ids)', { ids });

    // balances per account (all time)
    const bal = await base()
      .select('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debit - l.credit), 0)', 'bal')
      .groupBy('l.accountId')
      .getRawMany<{ accountId: string; bal: string }>();
    const balances = bal
      .map((b) => ({ accountId: b.accountId, accountName: info.get(b.accountId)?.name ?? b.accountId, kind: info.get(b.accountId)?.kind ?? 'other', balance: round2(Number(b.bal)) }))
      .filter((b) => Math.abs(b.balance) >= 0.005);

    let opening = 0;
    if (q.dateFrom) {
      const o = await base().select('COALESCE(SUM(l.debit - l.credit), 0)', 'v').andWhere('je.entryDate < :df', { df: q.dateFrom }).getRawOne<{ v: string }>();
      opening = round2(Number(o?.v ?? 0));
    }
    const qb = base()
      .select([
        'je.entryDate AS date',
        'je.entryNumber AS entryNumber',
        'je.sourceType AS sourceType',
        'je.sourceNumber AS sourceNumber',
        'je.id AS journalEntryId',
        'COALESCE(l.description, je.description) AS description',
        'l.accountId AS accountId',
        'l.debit AS debit',
        'l.credit AS credit',
      ])
      .orderBy('je.entryDate', 'ASC')
      .addOrderBy('je.createdAt', 'ASC')
      .addOrderBy('l.lineNumber', 'ASC');
    if (q.dateFrom) qb.andWhere('je.entryDate >= :df', { df: q.dateFrom });
    if (q.dateTo) qb.andWhere('je.entryDate <= :dt', { dt: q.dateTo });
    const raw = await qb.getRawMany<Record<string, unknown>>();
    let running = opening;
    const rows = raw.map((r) => {
      const debit = round2(Number(r.debit) || 0);
      const credit = round2(Number(r.credit) || 0);
      running = round2(running + debit - credit);
      const acc = info.get(String(r.accountId));
      return {
        date: toYmd(r.date),
        entryNumber: (r.entryNumber as string | null) ?? null,
        journalEntryId: String(r.journalEntryId),
        sourceType: String(r.sourceType),
        sourceNumber: (r.sourceNumber as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        accountId: String(r.accountId),
        accountName: acc?.name ?? '',
        kind: acc?.kind ?? 'other',
        debit,
        credit,
        balance: running,
      };
    });
    return { balances, total: round2(balances.reduce((s, b) => s + b.balance, 0)), opening, rows };
  }

  /** Every employee with a non-zero advances / custody balance + their next due installment. */
  async balances(q: { search?: string; branchId?: string }, scope: BranchScope) {
    const { ids, info } = await this.employeeAccounts();
    if (!ids.length) return { rows: [], totals: { advances: 0, custody: 0, other: 0, employees: 0 } };
    const qb = this.dataSource
      .getRepository(JournalEntryLine)
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .innerJoin(Employee, 'e', 'e.id = l.employeeId')
      .select('l.employeeId', 'employeeId')
      .addSelect('MAX(e.name)', 'name')
      .addSelect('MAX(e.code)', 'code')
      .addSelect('l.accountId', 'accountId')
      .addSelect('COALESCE(SUM(l.debit - l.credit), 0)', 'bal')
      .where('je.isPosted = 1')
      .andWhere('l.accountId IN (:...ids)', { ids })
      .groupBy('l.employeeId')
      .addGroupBy('l.accountId');
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s)', { s: `%${q.search}%` });
    if (q.branchId) qb.andWhere('l.branchId = :br', { br: q.branchId });
    applyBranchScope(qb, 'l.branchId', scope);
    const raw = await qb.getRawMany<{ employeeId: string; name: string; code: string; accountId: string; bal: string }>();

    const byEmp = new Map<string, { employeeId: string; name: string; code: string; advances: number; custody: number; other: number }>();
    for (const r of raw) {
      const row = byEmp.get(r.employeeId) ?? { employeeId: r.employeeId, name: r.name, code: r.code, advances: 0, custody: 0, other: 0 };
      row[info.get(r.accountId)?.kind ?? 'other'] = round2(row[info.get(r.accountId)?.kind ?? 'other'] + Number(r.bal));
      byEmp.set(r.employeeId, row);
    }
    const rows = [...byEmp.values()].filter((r) => Math.abs(r.advances) + Math.abs(r.custody) + Math.abs(r.other) >= 0.005);

    // next due installment per employee
    const next = rows.length
      ? await this.dataSource
          .getRepository(EmployeeAdvanceInstallment)
          .createQueryBuilder('i')
          .innerJoin('i.advance', 'a')
          .select('a.employeeId', 'employeeId')
          .addSelect('MIN(i.dueMonth)', 'dueMonth')
          .where(`a.status = 'paid'`)
          .andWhere('i.status <> :paid', { paid: InstallmentStatus.PAID })
          .andWhere('a.employeeId IN (:...emps)', { emps: rows.map((r) => r.employeeId) })
          .groupBy('a.employeeId')
          .getRawMany<{ employeeId: string; dueMonth: unknown }>()
      : [];
    const nextMap = new Map(next.map((n) => [n.employeeId, toYmd(n.dueMonth)]));
    const out = rows
      .map((r) => ({ ...r, total: round2(r.advances + r.custody + r.other), nextInstallmentMonth: nextMap.get(r.employeeId) ?? null }))
      .sort((a, b) => b.total - a.total);
    return {
      rows: out,
      totals: {
        advances: round2(out.reduce((s, r) => s + r.advances, 0)),
        custody: round2(out.reduce((s, r) => s + r.custody, 0)),
        other: round2(out.reduce((s, r) => s + r.other, 0)),
        employees: out.length,
      },
    };
  }
}
