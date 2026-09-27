/**
 * Pure math for the Product Income Summary — no DB, no Nest. Everything
 * here is exercised by product-income-math.spec.ts; the service only feeds
 * it aggregates it read from the ledger tables.
 */

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const r3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

export interface DateRange {
  from: string;
  to: string;
}
export type CompareMode = 'previous' | 'month' | 'year';

const iso = (d: Date) => {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const parse = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** Inclusive number of days in a range. */
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000) + 1;

/**
 * The period a report is compared against.
 *  - previous: the same number of days immediately before `from`
 *  - month:    both bounds shifted back one calendar month
 *  - year:     both bounds shifted back one calendar year
 */
export function previousRange(range: DateRange, mode: CompareMode): DateRange {
  const from = parse(range.from);
  const to = parse(range.to);
  if (mode === 'month') {
    return {
      from: iso(new Date(from.getFullYear(), from.getMonth() - 1, from.getDate())),
      to: iso(new Date(to.getFullYear(), to.getMonth() - 1, to.getDate())),
    };
  }
  if (mode === 'year') {
    return {
      from: iso(new Date(from.getFullYear() - 1, from.getMonth(), from.getDate())),
      to: iso(new Date(to.getFullYear() - 1, to.getMonth(), to.getDate())),
    };
  }
  const days = daysBetween(range.from, range.to);
  const prevTo = addDays(from, -1);
  return { from: iso(addDays(prevTo, -(days - 1))), to: iso(prevTo) };
}

/** Growth % against a base period; null when there is no base to compare against. */
export function growthPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return r2(((current - previous) / Math.abs(previous)) * 100);
}

export interface ProductMetricsInput {
  /** Σ posted invoice line quantity / netBeforeTax in the period. */
  quantitySold: number;
  grossRevenue: number;
  /** Σ posted return line quantity / netBeforeTax / (quantity × costAtPost). */
  quantityReturned: number;
  returns: number;
  returnCost: number;
  /** Confirmed delivery lines in the period: units and Σ lineCost. `null` when none exist. */
  delivered: { quantity: number; cost: number } | null;
  /** Product master flag — service products never have a cost basis. */
  trackInventory: boolean;
}

export interface ProductMetrics {
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  quantityDelivered: number;
  grossRevenue: number;
  returns: number;
  netRevenue: number;
  averageSellingPrice: number | null;
  returnRatePct: number | null;
  cogsAvailable: boolean;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
}

/**
 * Derives one product's row from its ledger aggregates.
 *
 *  net revenue  = gross − returns
 *  COGS         = Σ delivery lineCost − Σ return quantity × costAtPost
 *  gross profit = net revenue − COGS;  margin % = gross profit / net revenue
 *
 * A cost basis exists only when the product is inventory-tracked AND cost was
 * actually booked in the period (a confirmed delivery, or a costed return).
 * Otherwise cogs / profit / margin are null — never a fake 100 % margin.
 */
export function productMetrics(i: ProductMetricsInput): ProductMetrics {
  const netRevenue = r2(i.grossRevenue - i.returns);
  const cogsAvailable = i.trackInventory && (i.delivered !== null || i.returnCost > 0);
  const cogs = cogsAvailable ? r2((i.delivered?.cost ?? 0) - i.returnCost) : null;
  const grossProfit = cogs === null ? null : r2(netRevenue - cogs);
  return {
    quantitySold: i.quantitySold,
    quantityReturned: i.quantityReturned,
    netQuantity: r3(i.quantitySold - i.quantityReturned),
    quantityDelivered: i.delivered?.quantity ?? 0,
    grossRevenue: i.grossRevenue,
    returns: i.returns,
    netRevenue,
    averageSellingPrice: i.quantitySold > 0 ? r2(i.grossRevenue / i.quantitySold) : null,
    returnRatePct: i.quantitySold > 0 ? r2((i.quantityReturned / i.quantitySold) * 100) : null,
    cogsAvailable,
    cogs,
    grossProfit,
    grossMargin: grossProfit !== null && netRevenue > 0 ? r2((grossProfit / netRevenue) * 100) : null,
  };
}

export interface SummaryTotals {
  grossRevenue: number;
  returns: number;
  netRevenue: number;
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  cogsAvailable: boolean;
  /** Share (%) of net revenue that comes from products with a cost basis. */
  cogsCoveragePct: number | null;
}

/**
 * Period totals. Revenue sums every product; COGS / profit / margin cover only
 * the products with a cost basis, and `cogsCoveragePct` says how much of the
 * revenue that is — so a partially delivered period is never over-stated.
 */
export function summariseMetrics(rows: ProductMetrics[]): SummaryTotals {
  const grossRevenue = r2(rows.reduce((s, r) => s + r.grossRevenue, 0));
  const returns = r2(rows.reduce((s, r) => s + r.returns, 0));
  const netRevenue = r2(grossRevenue - returns);
  const withCost = rows.filter((r) => r.cogsAvailable);
  const cogsAvailable = withCost.length > 0;
  const cogs = cogsAvailable ? r2(withCost.reduce((s, r) => s + (r.cogs ?? 0), 0)) : null;
  const coveredRevenue = r2(withCost.reduce((s, r) => s + r.netRevenue, 0));
  const grossProfit = cogs === null ? null : r2(coveredRevenue - cogs);
  return {
    grossRevenue,
    returns,
    netRevenue,
    quantitySold: r3(rows.reduce((s, r) => s + r.quantitySold, 0)),
    quantityReturned: r3(rows.reduce((s, r) => s + r.quantityReturned, 0)),
    netQuantity: r3(rows.reduce((s, r) => s + r.netQuantity, 0)),
    cogs,
    grossProfit,
    grossMargin: grossProfit !== null && coveredRevenue > 0 ? r2((grossProfit / coveredRevenue) * 100) : null,
    cogsAvailable,
    cogsCoveragePct: netRevenue > 0 && cogsAvailable ? r2((coveredRevenue / netRevenue) * 100) : null,
  };
}
