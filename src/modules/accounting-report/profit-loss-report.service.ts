import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { applyBranchScope, BranchScope } from '../../common/utils/branch-scope.util';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { AccountSubType, AccountType } from '../chart-of-account/enums/account.enum';
import { Branch } from '../branch/entities/branch.entity';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { SalesReturnStatus } from '../sales-return/enums/sales-return.enum';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { Customer } from '../customer/entities/customer.entity';
import { ProductIncomeReportService } from './product-income-report.service';
import { ProductIncomeQueryDto } from './dto/product-income-query.dto';
import { ProfitLossCompare, ProfitLossQueryDto } from './dto/profit-loss-query.dto';
import { round2 } from './ledger-math';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';

export interface PnlTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  /** % of revenue (null when there is no revenue). */
  grossMargin: number | null;
  expenses: number;
  netProfit: number;
  netMargin: number | null;
}

export interface PnlAccountLine {
  accountId: string;
  code: string;
  name: string;
  nameEn: string | null;
  amount: number;
  compareAmount: number | null;
  /** % change vs the comparison window (null when not comparable). */
  changePct: number | null;
  /** Share of revenue (%). */
  pctOfRevenue: number | null;
}

export interface ProfitLossReport {
  /** fiscalYearId = the year containing `from` (for general-ledger drill-down). */
  period: { from: string; to: string; fiscalYearId: string | null };
  compare: { mode: ProfitLossCompare; from: string; to: string } | null;
  summary: PnlTotals;
  compareSummary: PnlTotals | null;
  statement: { revenues: PnlAccountLine[]; cogs: PnlAccountLine[]; expenses: PnlAccountLine[] };
  byMonth: (PnlTotals & { month: string })[];
  byBranch: (PnlTotals & { branchId: string | null; branchName: string })[];
  sales: {
    grossSales: number;
    discounts: number;
    returns: number;
    netSales: number;
    invoiceCount: number;
    returnCount: number;
    byCategory: { categoryId: string | null; categoryName: string; netRevenue: number; cogs: number | null; grossProfit: number | null; grossMargin: number | null }[];
    byProduct: { productId: string; productName: string; categoryName: string | null; netQuantity: number; netRevenue: number; cogs: number | null; grossProfit: number | null; grossMargin: number | null }[];
    byCustomer: { customerId: string; customerName: string; invoices: number; netSales: number; sharePct: number | null }[];
    byEmployee: { employeeId: string; employeeName: string; invoices: number; netSales: number; commission: number }[];
  };
}

interface Bucket { revenue: number; cogs: number; expenses: number }

const pct = (part: number, whole: number): number | null => (Math.abs(whole) >= 0.005 ? round2((part / whole) * 100) : null);
const change = (now: number, before: number | null): number | null =>
  before == null || Math.abs(before) < 0.005 ? null : round2(((now - before) / Math.abs(before)) * 100);

function totals(b: Bucket): PnlTotals {
  const revenue = round2(b.revenue);
  const cogs = round2(b.cogs);
  const expenses = round2(b.expenses);
  const grossProfit = round2(revenue - cogs);
  const netProfit = round2(grossProfit - expenses);
  return { revenue, cogs, grossProfit, grossMargin: pct(grossProfit, revenue), expenses, netProfit, netMargin: pct(netProfit, revenue) };
}

function shiftIso(iso: string, days: number, years = 0): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Profit & loss ANALYSIS (complements the formal income statement):
 * - figures come from POSTED journal lines on revenue / expense accounts — the
 *   same basis as the income statement (COGS = expense accounts of sub-type COGS),
 *   so totals reconcile with it;
 * - broken down by account, month and branch, compared to a previous window;
 * - plus a sales analysis from the sales documents (category / product via the
 *   product income report, customer, sales employee).
 * Read-only; restricted to the caller's branch scope.
 */
@Injectable()
export class ProfitLossReportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly productIncome: ProductIncomeReportService,
  ) {}

  async report(q: ProfitLossQueryDto, scope: BranchScope = null): Promise<ProfitLossReport> {
    if (q.dateFrom > q.dateTo) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const mode: ProfitLossCompare = q.compare ?? 'previous';
    const cmp = this.compareWindow(q.dateFrom, q.dateTo, mode);

    const [rows, cmpRows] = await Promise.all([
      this.ledgerRows(q.dateFrom, q.dateTo, q.branchId, scope),
      cmp ? this.ledgerRows(cmp.from, cmp.to, q.branchId, scope) : Promise.resolve([]),
    ]);
    const accountIds = [...new Set([...rows, ...cmpRows].map((r) => r.accountId))];
    const accounts = accountIds.length
      ? await this.dataSource.getRepository(ChartOfAccount).find({ where: accountIds.map((id) => ({ id })), withDeleted: true })
      : [];
    const acc = new Map(accounts.map((a) => [a.id, a]));
    const kind = (accountId: string): 'revenue' | 'cogs' | 'expenses' | null => {
      const a = acc.get(accountId);
      if (!a) return null;
      if (a.accountType === AccountType.REVENUE) return 'revenue';
      if (a.accountType === AccountType.EXPENSE) return a.accountSubType === AccountSubType.COGS ? 'cogs' : 'expenses';
      return null;
    };
    const signed = (k: 'revenue' | 'cogs' | 'expenses', d: number, c: number) => (k === 'revenue' ? c - d : d - c);

    // ── accumulate ──
    const total: Bucket = { revenue: 0, cogs: 0, expenses: 0 };
    const byAccount = new Map<string, number>();
    const byMonth = new Map<string, Bucket>();
    const byBranch = new Map<string, Bucket>();
    for (const r of rows) {
      const k = kind(r.accountId);
      if (!k) continue;
      const v = signed(k, r.debit, r.credit);
      total[k] += v;
      byAccount.set(r.accountId, (byAccount.get(r.accountId) ?? 0) + v);
      const m = byMonth.get(r.month) ?? { revenue: 0, cogs: 0, expenses: 0 };
      m[k] += v;
      byMonth.set(r.month, m);
      const bKey = r.branchId ?? '';
      const b = byBranch.get(bKey) ?? { revenue: 0, cogs: 0, expenses: 0 };
      b[k] += v;
      byBranch.set(bKey, b);
    }
    const cmpTotal: Bucket = { revenue: 0, cogs: 0, expenses: 0 };
    const cmpByAccount = new Map<string, number>();
    for (const r of cmpRows) {
      const k = kind(r.accountId);
      if (!k) continue;
      const v = signed(k, r.debit, r.credit);
      cmpTotal[k] += v;
      cmpByAccount.set(r.accountId, (cmpByAccount.get(r.accountId) ?? 0) + v);
    }
    const summary = totals(total);

    // ── statement lines ──
    const section = (k: 'revenue' | 'cogs' | 'expenses'): PnlAccountLine[] =>
      [...new Set([...byAccount.keys(), ...cmpByAccount.keys()])]
        .filter((id) => kind(id) === k)
        .map((id) => {
          const a = acc.get(id)!;
          const amount = round2(byAccount.get(id) ?? 0);
          const compareAmount = cmp ? round2(cmpByAccount.get(id) ?? 0) : null;
          return {
            accountId: id,
            code: a.accountCode,
            name: a.deletedAt ? `${a.accountNameAr} (محذوف)` : a.accountNameAr,
            nameEn: a.accountNameEn ?? null,
            amount,
            compareAmount,
            changePct: change(amount, compareAmount),
            pctOfRevenue: pct(amount, summary.revenue),
          };
        })
        .filter((l) => Math.abs(l.amount) >= 0.005 || Math.abs(l.compareAmount ?? 0) >= 0.005)
        .sort((x, y) => x.code.localeCompare(y.code));

    // ── branches ──
    const branchIds = [...byBranch.keys()].filter(Boolean);
    const branches = branchIds.length ? await this.dataSource.getRepository(Branch).find({ where: branchIds.map((id) => ({ id })), withDeleted: true }) : [];
    const branchName = new Map(branches.map((b) => [b.id, b.name]));

    const fiscalYear = await this.dataSource
      .getRepository(FiscalYear)
      .createQueryBuilder('fy')
      .where('fy.startDate <= :d AND fy.endDate >= :d', { d: q.dateFrom })
      .getOne();

    return {
      period: { from: q.dateFrom, to: q.dateTo, fiscalYearId: fiscalYear?.id ?? null },
      compare: cmp ? { mode, ...cmp } : null,
      summary,
      compareSummary: cmp ? totals(cmpTotal) : null,
      statement: { revenues: section('revenue'), cogs: section('cogs'), expenses: section('expenses') },
      byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, ...totals(b) })),
      byBranch: [...byBranch.entries()]
        .map(([id, b]) => ({ branchId: id || null, branchName: id ? branchName.get(id) ?? '—' : 'بدون فرع', ...totals(b) }))
        .sort((x, y) => y.revenue - x.revenue),
      sales: await this.salesAnalysis(q, scope),
    };
  }

  private compareWindow(from: string, to: string, mode: ProfitLossCompare): { from: string; to: string } | null {
    if (mode === 'none') return null;
    if (mode === 'last_year') return { from: shiftIso(from, 0, -1), to: shiftIso(to, 0, -1) };
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    return { from: shiftIso(from, -days), to: shiftIso(from, -1) };
  }

  /** Σdebit/Σcredit of POSTED lines by account × month × branch (same basis as the income statement). */
  private async ledgerRows(from: string, to: string, branchId: string | undefined, scope: BranchScope) {
    const qb = this.dataSource
      .getRepository(JournalEntryLine)
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .select('l.accountId', 'accountId')
      .addSelect(`DATE_FORMAT(je.entryDate, '%Y-%m')`, 'month')
      .addSelect('l.branchId', 'branchId')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'c')
      .where('je.isPosted = :posted', { posted: true })
      .andWhere('je.entryDate >= :from AND je.entryDate <= :to', { from, to })
      .groupBy('l.accountId')
      .addGroupBy('month')
      .addGroupBy('l.branchId');
    if (branchId) qb.andWhere('l.branchId = :branchId', { branchId });
    applyBranchScope(qb, 'l.branchId', scope);
    const raw = await qb.getRawMany<{ accountId: string; month: string; branchId: string | null; d: string; c: string }>();
    return raw.map((r) => ({ accountId: r.accountId, month: r.month, branchId: r.branchId, debit: Number(r.d), credit: Number(r.c) }));
  }

  /** Sales side from documents: gross/discount/returns, and by category, product, customer, employee. */
  private async salesAnalysis(q: ProfitLossQueryDto, scope: BranchScope): Promise<ProfitLossReport['sales']> {
    const inv = this.dataSource
      .getRepository(SalesInvoice)
      .createQueryBuilder('si')
      .where('si.status = :posted', { posted: SalesInvoiceStatus.POSTED })
      .andWhere('si.invoiceDate >= :from AND si.invoiceDate <= :to', { from: q.dateFrom, to: q.dateTo });
    if (q.branchId) inv.andWhere('si.branchId = :br', { br: q.branchId });
    applyBranchScope(inv, 'si.branchId', scope);

    const ret = this.dataSource
      .getRepository(SalesReturn)
      .createQueryBuilder('sr')
      .where('sr.status = :posted', { posted: SalesReturnStatus.POSTED })
      .andWhere('sr.returnDate >= :from AND sr.returnDate <= :to', { from: q.dateFrom, to: q.dateTo });
    if (q.branchId) ret.andWhere('sr.branchId = :br', { br: q.branchId });
    applyBranchScope(ret, 'sr.branchId', scope);

    const [invTot, retTot, invByCustomer, retByCustomer, byEmployee] = await Promise.all([
      inv.clone().select('COUNT(*)', 'n').addSelect('COALESCE(SUM(si.subtotal),0)', 'gross').addSelect('COALESCE(SUM(si.discountAmount),0)', 'disc').addSelect('COALESCE(SUM(si.taxableAmount),0)', 'net').getRawOne<Record<string, string>>(),
      ret.clone().select('COUNT(*)', 'n').addSelect('COALESCE(SUM(sr.taxableAmount),0)', 'net').getRawOne<Record<string, string>>(),
      inv.clone().select('si.customerId', 'id').addSelect('COUNT(*)', 'n').addSelect('COALESCE(SUM(si.taxableAmount),0)', 'net').groupBy('si.customerId').getRawMany<{ id: string; n: string; net: string }>(),
      ret.clone().select('sr.customerId', 'id').addSelect('COALESCE(SUM(sr.taxableAmount),0)', 'net').groupBy('sr.customerId').getRawMany<{ id: string; net: string }>(),
      inv
        .clone()
        .innerJoin(SalesInvoiceCommission, 'c', 'c.salesInvoiceId = si.id')
        .select('c.employeeId', 'id')
        .addSelect('MAX(c.employeeName)', 'name')
        .addSelect('COUNT(DISTINCT si.id)', 'n')
        .addSelect('COALESCE(SUM(si.taxableAmount),0)', 'net')
        .addSelect('COALESCE(SUM(c.amount),0)', 'commission')
        .groupBy('c.employeeId')
        .getRawMany<{ id: string; name: string; n: string; net: string; commission: string }>(),
    ]);

    const netSales = round2(Number(invTot?.net ?? 0) - Number(retTot?.net ?? 0));

    // customers: invoices − returns
    const retMap = new Map(retByCustomer.map((r) => [r.id, Number(r.net)]));
    const custIds = [...new Set([...invByCustomer.map((r) => r.id), ...retByCustomer.map((r) => r.id)])];
    const customers = custIds.length ? await this.dataSource.getRepository(Customer).find({ where: custIds.map((id) => ({ id })), withDeleted: true }) : [];
    const custName = new Map(customers.map((c) => [c.id, c.name]));
    const invMap = new Map(invByCustomer.map((r) => [r.id, r]));
    const byCustomer = custIds
      .map((id) => {
        const net = round2(Number(invMap.get(id)?.net ?? 0) - (retMap.get(id) ?? 0));
        return { customerId: id, customerName: custName.get(id) ?? '—', invoices: Number(invMap.get(id)?.n ?? 0), netSales: net, sharePct: pct(net, netSales) };
      })
      .sort((a, b) => b.netSales - a.netSales)
      .slice(0, 50);

    // products + categories (cost basis from the product income report)
    const piq = Object.assign(new ProductIncomeQueryDto(), {
      preset: 'custom',
      from: q.dateFrom,
      to: q.dateTo,
      branchId: q.branchId,
      page: 1,
      perPage: 5000,
      sortBy: 'netRevenue',
      sortOrder: 'desc',
    }) as ProductIncomeQueryDto;
    const pi = await this.productIncome.summary(piq, scope);
    const products = pi.products.items;
    const cat = new Map<string, { categoryId: string | null; categoryName: string; netRevenue: number; costedRevenue: number; cogs: number | null; grossProfit: number | null }>();
    for (const p of products) {
      const key = p.categoryId ?? '__none';
      const c = cat.get(key) ?? { categoryId: p.categoryId, categoryName: p.categoryName ?? 'بدون تصنيف', netRevenue: 0, costedRevenue: 0, cogs: null, grossProfit: null };
      c.netRevenue += p.netRevenue;
      if (p.cogs != null) c.cogs = (c.cogs ?? 0) + p.cogs;
      if (p.grossProfit != null) {
        c.grossProfit = (c.grossProfit ?? 0) + p.grossProfit;
        c.costedRevenue += p.netRevenue; // margin only over products whose cost is known
      }
      cat.set(key, c);
    }

    return {
      grossSales: round2(Number(invTot?.gross ?? 0)),
      discounts: round2(Number(invTot?.disc ?? 0)),
      returns: round2(Number(retTot?.net ?? 0)),
      netSales,
      invoiceCount: Number(invTot?.n ?? 0),
      returnCount: Number(retTot?.n ?? 0),
      byCategory: [...cat.values()]
        .map(({ costedRevenue, ...c }) => ({
          ...c,
          netRevenue: round2(c.netRevenue),
          cogs: c.cogs == null ? null : round2(c.cogs),
          grossProfit: c.grossProfit == null ? null : round2(c.grossProfit),
          grossMargin: c.grossProfit == null ? null : pct(c.grossProfit, costedRevenue),
        }))
        .sort((a, b) => b.netRevenue - a.netRevenue),
      byProduct: products.slice(0, 50).map((p) => ({
        productId: p.productId,
        productName: p.productName,
        categoryName: p.categoryName,
        netQuantity: p.netQuantity,
        netRevenue: p.netRevenue,
        cogs: p.cogs,
        grossProfit: p.grossProfit,
        grossMargin: p.grossMargin,
      })),
      byCustomer,
      byEmployee: byEmployee
        .map((e) => ({ employeeId: e.id, employeeName: e.name ?? '—', invoices: Number(e.n), netSales: round2(Number(e.net)), commission: round2(Number(e.commission)) }))
        .sort((a, b) => b.netSales - a.netSales),
    };
  }
}
