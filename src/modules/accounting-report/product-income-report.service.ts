import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { BranchScope, applyBranchScope } from '../../common/utils/branch-scope.util';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { SalesReturnItem } from '../sales-return/entities/sales-return-item.entity';
import { SalesDelivery } from '../sales-delivery/entities/sales-delivery.entity';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { Product } from '../product/entities/product.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';
import { Brand } from '../brand/entities/brand.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { ProductIncomeCompare, ProductIncomePreset, ProductIncomeQueryDto } from './dto/product-income-query.dto';
import { daysBetween, growthPct, previousRange, productMetrics, r2, r3, summariseMetrics } from './product-income-math';

/**
 * Product Income Summary — product-level revenue, returns, COGS and gross
 * profit for a period. Every number is what the accounting engine already
 * booked; nothing is re-computed from prices or master costs:
 *
 *  Gross revenue   = Σ sales_invoice_items.netBeforeTax  (POSTED invoices, by invoiceDate)
 *                    — the amount credited to the revenue account per line.
 *  Returns         = Σ sales_return_items.netBeforeTax   (POSTED returns, by returnDate)
 *                    — the amount debited back to revenue.
 *  Net revenue     = gross revenue − returns
 *  COGS            = Σ sales_invoice_items.cogsAccrued    (POSTED invoices, by invoiceDate — cost booked WITH the invoice)
 *                    + Σ (sales_delivery_items.lineCost − cogsAccrualSettled)  (confirmed lines, by actualDeliveryDate —
 *                      the actual-vs-estimate gap, or the whole cost for invoices posted without an accrual)
 *                    − Σ sales_return_items.cogsAccrualReleased (POSTED returns of never-delivered qty, by returnDate)
 *                    − Σ sales_return_items.quantity × costAtPost (POSTED returns)
 *                    — exactly the DR/CR movements on the COGS account.
 *  Gross profit    = net revenue − COGS;  margin % = gross profit / net revenue.
 *
 * A product has a COST BASIS in the period only when it is inventory-tracked
 * AND at least one delivery line was confirmed (or a return posted with cost)
 * inside the period. Service products never have one; a stock product that was
 * invoiced but not yet delivered has none either — its cost is not booked yet,
 * so reporting "100 % margin" would be a lie. Such rows expose null profit
 * fields and the summary reports the share of revenue that IS cost-covered
 * (`cogsCoveragePct`) instead of pretending.
 *
 * NOTE on timing (matching): when «بضاعة مباعة لم تُسلَّم» is configured, COGS is
 * booked WITH the invoice (estimated: stock = avg cost, manufacturing = components
 * × current cost + fee) and only the actual-vs-estimate gap lands on the delivery
 * date — so a month's profit pairs its revenue with its cost. Invoices posted
 * before that (or with no clearing account) keep the legacy rule: cost on the
 * actual delivery date. Identical to the general ledger either way.
 * Aggregation is done in SQL (grouped by product); only per-product totals
 * reach memory.
 */

export interface ProductIncomeSummary {
  grossRevenue: number;
  returns: number;
  netRevenue: number;
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  invoiceCount: number;
  productCount: number;
  /** COGS / profit over the products that have a cost basis; null when none do. */
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  /** True when at least one product in the result has a cost basis. */
  cogsAvailable: boolean;
  /** Share (%) of net revenue that comes from products with a cost basis. */
  cogsCoveragePct: number | null;
}

export interface ProductIncomeRow {
  productId: string;
  productName: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandName: string | null;
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  grossRevenue: number;
  returns: number;
  netRevenue: number;
  averageSellingPrice: number | null;
  returnRatePct: number | null;
  /** Units whose cost was booked (confirmed delivery lines) inside the period. */
  quantityDelivered: number;
  /** False for service products and for stock products with nothing delivered yet. */
  cogsAvailable: boolean;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  rank: number;
}

export interface ProductIncomeReport {
  period: { from: string; to: string; preset: ProductIncomePreset };
  bucket: 'day' | 'month';
  summary: ProductIncomeSummary;
  comparison: {
    mode: ProductIncomeCompare;
    period: { from: string; to: string };
    summary: ProductIncomeSummary;
    growth: { grossRevenue: number | null; netRevenue: number | null; grossProfit: number | null; quantitySold: number | null };
  } | null;
  products: { items: ProductIncomeRow[]; total: number; page: number; perPage: number };
  top: {
    byRevenue: ProductIncomeRow[];
    byProfit: ProductIncomeRow[];
    lowMargin: ProductIncomeRow[];
    mostReturned: ProductIncomeRow[];
  };
  trend: { bucket: string; grossRevenue: number; returns: number; netRevenue: number; cogs: number }[];
  byCategory: { categoryId: string | null; categoryName: string; netRevenue: number; sharePct: number }[];
}

interface Range { from: string; to: string }
interface SalesAgg { productId: string; qty: number; gross: number }
interface ReturnAgg { productId: string; qty: number; amount: number; cost: number }
interface CogsAgg { productId: string; qty: number; cogs: number }

const POSTED = 'posted';
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);
const iso = (d: Date) => {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const parse = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

@Injectable()
export class ProductIncomeReportService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(q: ProductIncomeQueryDto, scope: BranchScope = null): Promise<ProductIncomeReport> {
    const { range, preset } = await this.resolveRange(q);
    if (parse(range.from) > parse(range.to)) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');

    const [sales, returns, cogs, invoices] = await Promise.all([
      this.salesAgg(range, q, scope),
      this.returnsAgg(range, q, scope),
      this.cogsAgg(range, q, scope),
      this.invoiceCount(range, q, scope),
    ]);
    const rows = await this.buildRows(sales, returns, cogs);
    const summary = this.summarise(rows, invoices);

    // Sort + paginate the product table; rankings come from the full set.
    const sorted = this.sort(rows, q.sortBy, q.sortOrder);
    sorted.forEach((r, i) => (r.rank = i + 1));
    const page = Math.max(1, q.page || 1);
    const perPage = Math.max(1, q.perPage || 20);
    const items = sorted.slice((page - 1) * perPage, page * perPage);

    const withCost = rows.filter((r) => r.cogsAvailable && r.netRevenue > 0);
    const top = {
      byRevenue: this.sort(rows, 'netRevenue', 'desc').filter((r) => r.netRevenue > 0).slice(0, 5),
      byProfit: this.sort(withCost, 'grossProfit', 'desc').slice(0, 5),
      lowMargin: this.sort(withCost, 'grossMargin', 'asc').slice(0, 5),
      mostReturned: this.sort(rows.filter((r) => r.quantityReturned > 0), 'quantityReturned', 'desc').slice(0, 5),
    };

    const bucket: 'day' | 'month' = daysBetween(range.from, range.to) > 62 ? 'month' : 'day';
    const [trend, comparison] = await Promise.all([
      this.trend(range, bucket, q, scope),
      q.compare ? this.comparison(range, q, scope) : Promise.resolve(null),
    ]);
    if (comparison) {
      comparison.growth = {
        grossRevenue: growthPct(summary.grossRevenue, comparison.summary.grossRevenue),
        netRevenue: growthPct(summary.netRevenue, comparison.summary.netRevenue),
        grossProfit: growthPct(summary.grossProfit, comparison.summary.grossProfit),
        quantitySold: growthPct(summary.quantitySold, comparison.summary.quantitySold),
      };
    }

    return {
      period: { ...range, preset },
      bucket,
      summary,
      comparison,
      products: { items, total: rows.length, page, perPage },
      top,
      trend,
      byCategory: this.byCategory(rows),
    };
  }

  // =========================================================
  // Period resolution (server-side normalisation)
  // =========================================================
  private async resolveRange(q: ProductIncomeQueryDto): Promise<{ range: Range; preset: ProductIncomePreset }> {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const preset: ProductIncomePreset = q.preset ?? (q.from || q.to ? 'custom' : 'this_month');
    const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 1) % 7)); // Saturday-based week

    switch (preset) {
      case 'today': return { preset, range: { from: iso(today), to: iso(today) } };
      case 'yesterday': { const d = addDays(today, -1); return { preset, range: { from: iso(d), to: iso(d) } }; }
      case 'this_week': { const s = startOfWeek(today); return { preset, range: { from: iso(s), to: iso(addDays(s, 6)) } }; }
      case 'last_week': { const s = addDays(startOfWeek(today), -7); return { preset, range: { from: iso(s), to: iso(addDays(s, 6)) } }; }
      case 'this_month': return { preset, range: { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) } };
      case 'last_month': return { preset, range: { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) } };
      case 'this_year': return { preset, range: { from: `${y}-01-01`, to: `${y}-12-31` } };
      case 'last_year': return { preset, range: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } };
      case 'fiscal_year': {
        const fy = await this.dataSource.getRepository(FiscalYear).findOne({ where: { isCurrent: true } });
        if (!fy) throw new BadRequestException('لا توجد سنة مالية حالية محددة');
        return { preset, range: { from: String(fy.startDate).slice(0, 10), to: String(fy.endDate).slice(0, 10) } };
      }
      case 'accounting_period': {
        const t = iso(today);
        const p = await this.dataSource
          .getRepository(AccountingPeriod)
          .createQueryBuilder('p')
          .where('p.startDate <= :t AND p.endDate >= :t', { t })
          .getOne();
        if (!p) throw new BadRequestException('لا توجد فترة محاسبية تشمل تاريخ اليوم');
        return { preset, range: { from: String(p.startDate).slice(0, 10), to: String(p.endDate).slice(0, 10) } };
      }
      default: {
        if (!q.from || !q.to) throw new BadRequestException('حدد تاريخ البداية والنهاية للفترة المخصصة');
        return { preset: 'custom', range: { from: q.from.slice(0, 10), to: q.to.slice(0, 10) } };
      }
    }
  }

  // =========================================================
  // SQL aggregates (grouped by product)
  // =========================================================
  /** Product-side filters shared by the three aggregates (joins `p`). */
  private productFilters(qb: SelectQueryBuilder<ObjectLiteral>, itemAlias: string, q: ProductIncomeQueryDto): void {
    qb.innerJoin(Product, 'p', `p.id = ${itemAlias}.productId`);
    if (q.productId) qb.andWhere(`${itemAlias}.productId = :productId`, { productId: q.productId });
    if (q.categoryId) qb.andWhere('p.categoryId = :categoryId', { categoryId: q.categoryId });
    if (q.brandId) qb.andWhere('p.brandId = :brandId', { brandId: q.brandId });
    if (q.search) qb.andWhere('(p.name LIKE :s OR p.code LIKE :s OR p.barcode LIKE :s)', { s: `%${q.search}%` });
  }

  /** Posted invoice lines in range with every header/product filter applied (no select yet). */
  private salesBase(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): SelectQueryBuilder<ObjectLiteral> {
    const qb = this.dataSource
      .createQueryBuilder()
      .from(SalesInvoiceItem, 'ii')
      .innerJoin(SalesInvoice, 'si', 'si.id = ii.salesInvoiceId AND si.deletedAt IS NULL')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', range)
      .andWhere('ii.deletedAt IS NULL');
    applyBranchScope(qb, 'si.branchId', scope);
    if (q.branchId) qb.andWhere('si.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('si.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) qb.andWhere('COALESCE(ii.warehouseId, si.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(qb, 'ii', q);
    return qb;
  }

  private async salesAgg(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): Promise<SalesAgg[]> {
    const raw = await this.salesBase(range, q, scope)
      .select('ii.productId', 'productId')
      .addSelect('COALESCE(SUM(ii.quantity), 0)', 'qty')
      .addSelect('COALESCE(SUM(ii.netBeforeTax), 0)', 'gross')
      .groupBy('ii.productId')
      .getRawMany<{ productId: string; qty: string; gross: string }>();
    return raw.map((r) => ({ productId: r.productId, qty: r3(n(r.qty)), gross: r2(n(r.gross)) }));
  }

  /** Distinct posted invoices in range — an invoice with several products counts once. */
  private async invoiceCount(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): Promise<number> {
    const raw = await this.salesBase(range, q, scope).select('COUNT(DISTINCT si.id)', 'c').getRawOne<{ c: string }>();
    return n(raw?.c);
  }

  private async returnsAgg(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): Promise<ReturnAgg[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('ri.productId', 'productId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .addSelect('COALESCE(SUM(ri.netBeforeTax), 0)', 'amount')
      .addSelect('COALESCE(SUM(ri.quantity * ri.costAtPost), 0)', 'cost')
      .from(SalesReturnItem, 'ri')
      .innerJoin(SalesReturn, 'sr', 'sr.id = ri.salesReturnId AND sr.deletedAt IS NULL')
      .where('sr.status = :st', { st: POSTED })
      .andWhere('sr.returnDate BETWEEN :from AND :to', range)
      .andWhere('ri.deletedAt IS NULL');
    applyBranchScope(qb, 'sr.branchId', scope);
    if (q.branchId) qb.andWhere('sr.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('sr.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) qb.andWhere('COALESCE(ri.warehouseId, sr.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(qb, 'ri', q);
    qb.groupBy('ri.productId');
    const raw = await qb.getRawMany<{ productId: string; qty: string; amount: string; cost: string }>();
    return raw.map((r) => ({ productId: r.productId, qty: r3(n(r.qty)), amount: r2(n(r.amount)), cost: r2(n(r.cost)) }));
  }

  /**
   * COGS per product exactly as booked on the COGS account in the period:
   * invoice accruals (invoice date) + delivery entries net of the accrual they
   * cleared (delivery date) − accruals released by returns (return date).
   */
  private async cogsAgg(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): Promise<CogsAgg[]> {
    const [accrued, delivered, released] = await Promise.all([
      this.accruedQb(range, q, scope, 'ii.productId').getRawMany<{ k: string; v: string }>(),
      this.deliveryCostQb(range, q, scope, 'di.productId')
        .addSelect('COALESCE(SUM(di.deliveredQuantity), 0)', 'qty')
        .getRawMany<{ k: string; v: string; qty: string }>(),
      this.releasedQb(range, q, scope, 'ri.productId').getRawMany<{ k: string; v: string }>(),
    ]);
    const map = new Map<string, CogsAgg>();
    const get = (id: string) => map.get(id) ?? map.set(id, { productId: id, qty: 0, cogs: 0 }).get(id)!;
    for (const r of accrued) get(r.k).cogs += n(r.v);
    for (const r of delivered) { const g = get(r.k); g.cogs += n(r.v); g.qty += n(r.qty); }
    for (const r of released) get(r.k).cogs -= n(r.v);
    return [...map.values()].map((c) => ({ productId: c.productId, qty: r3(c.qty), cogs: r2(c.cogs) }));
  }

  /** Σ cost accrued with POSTED invoices (by invoice date), grouped by `groupExpr`. */
  private accruedQb(range: Range, q: ProductIncomeQueryDto, scope: BranchScope, groupExpr: string) {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(groupExpr, 'k')
      .addSelect('COALESCE(SUM(ii.cogsAccrued), 0)', 'v')
      .from(SalesInvoiceItem, 'ii')
      .innerJoin(SalesInvoice, 'si', 'si.id = ii.salesInvoiceId AND si.deletedAt IS NULL')
      .where('si.status = :st', { st: POSTED })
      .andWhere('ii.cogsAccrued > 0')
      .andWhere('si.invoiceDate BETWEEN :from AND :to', range)
      .andWhere('ii.deletedAt IS NULL');
    applyBranchScope(qb, 'si.branchId', scope);
    if (q.branchId) qb.andWhere('si.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('si.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) qb.andWhere('COALESCE(ii.warehouseId, si.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(qb, 'ii', q);
    return qb.groupBy(groupExpr);
  }

  /** Σ delivery cost net of the invoice accrual it cleared (by actual delivery date). */
  private deliveryCostQb(range: Range, q: ProductIncomeQueryDto, scope: BranchScope, groupExpr: string) {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(groupExpr, 'k')
      .addSelect('COALESCE(SUM(di.lineCost - di.cogsAccrualSettled), 0)', 'v')
      .from(SalesDeliveryItem, 'di')
      .innerJoin(SalesDelivery, 'sd', 'sd.id = di.salesDeliveryId AND sd.deletedAt IS NULL')
      .where('(di.lineCost > 0 OR di.cogsAccrualSettled > 0)')
      .andWhere('di.actualDeliveryDate BETWEEN :from AND :to', range)
      .andWhere('di.deletedAt IS NULL');
    applyBranchScope(qb, 'sd.branchId', scope);
    if (q.branchId) qb.andWhere('sd.branchId = :branchId', { branchId: q.branchId });
    if (q.warehouseId) qb.andWhere('COALESCE(di.warehouseId, sd.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    if (q.customerId) qb.innerJoin(SalesInvoice, 'si', 'si.id = sd.salesInvoiceId').andWhere('si.customerId = :customerId', { customerId: q.customerId });
    this.productFilters(qb, 'di', q);
    return qb.groupBy(groupExpr);
  }

  /** Σ accrual released by POSTED returns of never-delivered quantity (by return date). */
  private releasedQb(range: Range, q: ProductIncomeQueryDto, scope: BranchScope, groupExpr: string) {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(groupExpr, 'k')
      .addSelect('COALESCE(SUM(ri.cogsAccrualReleased), 0)', 'v')
      .from(SalesReturnItem, 'ri')
      .innerJoin(SalesReturn, 'sr', 'sr.id = ri.salesReturnId AND sr.deletedAt IS NULL')
      .where('sr.status = :st', { st: POSTED })
      .andWhere('ri.cogsAccrualReleased > 0')
      .andWhere('sr.returnDate BETWEEN :from AND :to', range)
      .andWhere('ri.deletedAt IS NULL');
    applyBranchScope(qb, 'sr.branchId', scope);
    if (q.branchId) qb.andWhere('sr.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('sr.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) qb.andWhere('COALESCE(ri.warehouseId, sr.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(qb, 'ri', q);
    return qb.groupBy(groupExpr);
  }

  /** Revenue / returns / COGS per day or month for the trend chart. */
  private async trend(range: Range, bucket: 'day' | 'month', q: ProductIncomeQueryDto, scope: BranchScope) {
    const fmt = bucket === 'month' ? '%Y-%m' : '%Y-%m-%d';
    const salesQb = this.dataSource
      .createQueryBuilder()
      .select(`DATE_FORMAT(si.invoiceDate, '${fmt}')`, 'bucket')
      .addSelect('COALESCE(SUM(ii.netBeforeTax), 0)', 'v')
      .from(SalesInvoiceItem, 'ii')
      .innerJoin(SalesInvoice, 'si', 'si.id = ii.salesInvoiceId AND si.deletedAt IS NULL')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', range)
      .andWhere('ii.deletedAt IS NULL');
    applyBranchScope(salesQb, 'si.branchId', scope);
    if (q.branchId) salesQb.andWhere('si.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) salesQb.andWhere('si.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) salesQb.andWhere('COALESCE(ii.warehouseId, si.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(salesQb, 'ii', q);
    salesQb.groupBy('bucket');

    const retQb = this.dataSource
      .createQueryBuilder()
      .select(`DATE_FORMAT(sr.returnDate, '${fmt}')`, 'bucket')
      .addSelect('COALESCE(SUM(ri.netBeforeTax), 0)', 'v')
      .from(SalesReturnItem, 'ri')
      .innerJoin(SalesReturn, 'sr', 'sr.id = ri.salesReturnId AND sr.deletedAt IS NULL')
      .where('sr.status = :st', { st: POSTED })
      .andWhere('sr.returnDate BETWEEN :from AND :to', range)
      .andWhere('ri.deletedAt IS NULL');
    applyBranchScope(retQb, 'sr.branchId', scope);
    if (q.branchId) retQb.andWhere('sr.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) retQb.andWhere('sr.customerId = :customerId', { customerId: q.customerId });
    if (q.warehouseId) retQb.andWhere('COALESCE(ri.warehouseId, sr.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    this.productFilters(retQb, 'ri', q);
    retQb.groupBy('bucket');

    const bAcc = `DATE_FORMAT(si.invoiceDate, '${fmt}')`;
    const bDel = `DATE_FORMAT(di.actualDeliveryDate, '${fmt}')`;
    const bRel = `DATE_FORMAT(sr.returnDate, '${fmt}')`;

    const [s, r, ca, cd, cr] = await Promise.all([
      salesQb.getRawMany<{ bucket: string; v: string }>(),
      retQb.getRawMany<{ bucket: string; v: string }>(),
      this.accruedQb(range, q, scope, bAcc).getRawMany<{ k: string; v: string }>(),
      this.deliveryCostQb(range, q, scope, bDel).getRawMany<{ k: string; v: string }>(),
      this.releasedQb(range, q, scope, bRel).getRawMany<{ k: string; v: string }>(),
    ]);
    const map = new Map<string, { bucket: string; grossRevenue: number; returns: number; netRevenue: number; cogs: number }>();
    const get = (b: string) => map.get(b) ?? map.set(b, { bucket: b, grossRevenue: 0, returns: 0, netRevenue: 0, cogs: 0 }).get(b)!;
    for (const x of s) get(x.bucket).grossRevenue = r2(n(x.v));
    for (const x of r) get(x.bucket).returns = r2(n(x.v));
    for (const x of ca) get(x.k).cogs = r2(get(x.k).cogs + n(x.v));
    for (const x of cd) get(x.k).cogs = r2(get(x.k).cogs + n(x.v));
    for (const x of cr) get(x.k).cogs = r2(get(x.k).cogs - n(x.v));
    for (const e of map.values()) e.netRevenue = r2(e.grossRevenue - e.returns);
    return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  private async comparison(range: Range, q: ProductIncomeQueryDto, scope: BranchScope): Promise<ProductIncomeReport['comparison']> {
    const prev = previousRange(range, q.compare!);
    const [sales, returns, cogs, invoices] = await Promise.all([
      this.salesAgg(prev, q, scope),
      this.returnsAgg(prev, q, scope),
      this.cogsAgg(prev, q, scope),
      this.invoiceCount(prev, q, scope),
    ]);
    const rows = await this.buildRows(sales, returns, cogs);
    const summary = this.summarise(rows, invoices);
    return { mode: q.compare!, period: prev, summary, growth: {
      grossRevenue: null, netRevenue: null, grossProfit: null, quantitySold: null,
    } };
  }

  // =========================================================
  // Merge + derived metrics
  // =========================================================
  private async buildRows(sales: SalesAgg[], returns: ReturnAgg[], cogs: CogsAgg[]): Promise<ProductIncomeRow[]> {
    const ids = [...new Set([...sales.map((s) => s.productId), ...returns.map((r) => r.productId), ...cogs.map((c) => c.productId)])];
    if (!ids.length) return [];
    const products = await this.dataSource.getRepository(Product).find({ where: { id: In(ids) }, withDeleted: true });
    const catIds = [...new Set(products.map((p) => p.categoryId).filter((v): v is string => !!v))];
    const brandIds = [...new Set(products.map((p) => p.brandId).filter((v): v is string => !!v))];
    const [cats, brands] = await Promise.all([
      catIds.length ? this.dataSource.getRepository(ProductCategory).find({ where: { id: In(catIds) }, withDeleted: true }) : Promise.resolve([] as ProductCategory[]),
      brandIds.length ? this.dataSource.getRepository(Brand).find({ where: { id: In(brandIds) }, withDeleted: true }) : Promise.resolve([] as Brand[]),
    ]);
    const pMap = new Map(products.map((p) => [p.id, p]));
    const cMap = new Map<string, string>(cats.map((c) => [c.id, c.name]));
    const bMap = new Map<string, string>(brands.map((b) => [b.id, b.name]));
    const sMap = new Map(sales.map((s) => [s.productId, s]));
    const rMap = new Map(returns.map((r) => [r.productId, r]));
    const kMap = new Map(cogs.map((c) => [c.productId, c]));

    return ids.map((id) => {
      const p = pMap.get(id);
      const s = sMap.get(id);
      const r = rMap.get(id);
      const k = kMap.get(id);
      return {
        productId: id,
        productName: p?.name ?? '—',
        sku: p?.code ?? null,
        categoryId: p?.categoryId ?? null,
        categoryName: p?.categoryId ? (cMap.get(p.categoryId) ?? null) : null,
        brandName: p?.brandId ? (bMap.get(p.brandId) ?? null) : null,
        ...productMetrics({
          quantitySold: s?.qty ?? 0,
          grossRevenue: s?.gross ?? 0,
          quantityReturned: r?.qty ?? 0,
          returns: r?.amount ?? 0,
          returnCost: r?.cost ?? 0,
          delivered: k ? { quantity: k.qty, cost: k.cogs } : null,
          trackInventory: !!p?.trackInventory,
        }),
        rank: 0,
      };
    });
  }

  private summarise(rows: ProductIncomeRow[], invoiceCount: number): ProductIncomeSummary {
    return { ...summariseMetrics(rows), invoiceCount, productCount: rows.length };
  }

  private sort(rows: ProductIncomeRow[], by: string, order: 'asc' | 'desc'): ProductIncomeRow[] {
    const dir = order === 'asc' ? 1 : -1;
    const val = (r: ProductIncomeRow): number => {
      const v = (r as unknown as Record<string, unknown>)[by];
      return typeof v === 'number' ? v : Number.NEGATIVE_INFINITY * dir; // nulls sink to the end
    };
    return [...rows].sort((a, b) => (val(a) - val(b)) * dir || a.productName.localeCompare(b.productName, 'ar'));
  }

  private byCategory(rows: ProductIncomeRow[]): ProductIncomeReport['byCategory'] {
    const total = rows.reduce((s, r) => s + r.netRevenue, 0);
    const map = new Map<string, { categoryId: string | null; categoryName: string; netRevenue: number }>();
    for (const r of rows) {
      const key = r.categoryId ?? '__none';
      const e = map.get(key) ?? { categoryId: r.categoryId, categoryName: r.categoryName ?? 'بدون تصنيف', netRevenue: 0 };
      e.netRevenue = r2(e.netRevenue + r.netRevenue);
      map.set(key, e);
    }
    return [...map.values()]
      .filter((c) => c.netRevenue !== 0)
      .sort((a, b) => b.netRevenue - a.netRevenue)
      .map((c) => ({ ...c, sharePct: total > 0 ? r2((c.netRevenue / total) * 100) : 0 }));
  }
}
