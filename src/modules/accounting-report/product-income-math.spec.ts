import { growthPct, previousRange, productMetrics, summariseMetrics, ProductMetricsInput } from './product-income-math';

const base: ProductMetricsInput = {
  quantitySold: 4,
  grossRevenue: 20000,
  quantityReturned: 0,
  returns: 0,
  returnCost: 0,
  delivered: { quantity: 4, cost: 12000 },
  trackInventory: true,
};

describe('product-income-math', () => {
  describe('productMetrics', () => {
    it('net revenue − COGS = gross profit, margin on net revenue', () => {
      const m = productMetrics(base);
      expect(m).toMatchObject({ netRevenue: 20000, cogs: 12000, grossProfit: 8000, grossMargin: 40, cogsAvailable: true, quantityDelivered: 4 });
      expect(m.averageSellingPrice).toBe(5000);
    });

    it('returns reduce net revenue AND reverse COGS at cost-at-post', () => {
      // 1 unit returned at 5000 revenue; it was costed at 3000 when the return posted
      const m = productMetrics({ ...base, quantityReturned: 1, returns: 5000, returnCost: 3000 });
      expect(m).toMatchObject({ netQuantity: 3, netRevenue: 15000, cogs: 9000, grossProfit: 6000, grossMargin: 40, returnRatePct: 25 });
    });

    it('service product → no cost basis, profit fields null', () => {
      const m = productMetrics({ ...base, trackInventory: false });
      expect(m).toMatchObject({ cogsAvailable: false, cogs: null, grossProfit: null, grossMargin: null, netRevenue: 20000 });
    });

    it('stock product invoiced but not delivered → no cost basis (never a fake 100 % margin)', () => {
      const m = productMetrics({ ...base, delivered: null });
      expect(m).toMatchObject({ cogsAvailable: false, cogs: null, grossProfit: null, grossMargin: null, quantityDelivered: 0 });
    });

    it('a costed return alone still yields a cost basis (negative COGS)', () => {
      const m = productMetrics({ ...base, quantitySold: 0, grossRevenue: 0, delivered: null, quantityReturned: 1, returns: 5000, returnCost: 3000 });
      expect(m).toMatchObject({ cogsAvailable: true, cogs: -3000, netRevenue: -5000, grossProfit: -2000, grossMargin: null, averageSellingPrice: null });
    });

    it('selling below cost → negative profit and margin', () => {
      const m = productMetrics({ ...base, grossRevenue: 10000 });
      expect(m).toMatchObject({ grossProfit: -2000, grossMargin: -20 });
    });

    it('partial delivery keeps the cost of delivered units only and exposes it', () => {
      const m = productMetrics({ ...base, delivered: { quantity: 2, cost: 6000 } });
      expect(m).toMatchObject({ quantityDelivered: 2, cogs: 6000, grossProfit: 14000 });
    });
  });

  describe('summariseMetrics', () => {
    it('COGS/profit cover only products with a cost basis and coverage % says how much', () => {
      const rows = [
        productMetrics(base), // 20000 net, 12000 cost
        productMetrics({ ...base, grossRevenue: 5000, delivered: null }), // undelivered
        productMetrics({ ...base, grossRevenue: 5000, trackInventory: false }), // service
      ];
      const s = summariseMetrics(rows);
      expect(s).toMatchObject({ grossRevenue: 30000, netRevenue: 30000, cogs: 12000, grossProfit: 8000, grossMargin: 40, cogsAvailable: true });
      expect(s.cogsCoveragePct).toBeCloseTo(66.67, 2);
    });

    it('no product with a cost basis → cogsAvailable false, nulls', () => {
      const s = summariseMetrics([productMetrics({ ...base, delivered: null })]);
      expect(s).toMatchObject({ cogsAvailable: false, cogs: null, grossProfit: null, grossMargin: null, cogsCoveragePct: null, netRevenue: 20000 });
    });

    it('empty → zeros', () => {
      expect(summariseMetrics([])).toMatchObject({ grossRevenue: 0, netRevenue: 0, quantitySold: 0, cogsAvailable: false });
    });
  });

  describe('growthPct', () => {
    it('positive growth', () => expect(growthPct(120, 100)).toBe(20));
    it('decline', () => expect(growthPct(80, 100)).toBe(-20));
    it('negative base uses its magnitude', () => expect(growthPct(-50, -100)).toBe(50));
    it('no base → null', () => {
      expect(growthPct(100, 0)).toBeNull();
      expect(growthPct(100, null)).toBeNull();
      expect(growthPct(null, 100)).toBeNull();
    });
  });

  describe('previousRange', () => {
    it('previous: same length, ending the day before', () => {
      expect(previousRange({ from: '2026-09-01', to: '2026-09-30' }, 'previous')).toEqual({ from: '2026-08-02', to: '2026-08-31' });
      expect(previousRange({ from: '2026-09-27', to: '2026-09-27' }, 'previous')).toEqual({ from: '2026-09-26', to: '2026-09-26' });
    });
    it('month: shifts both bounds one calendar month back', () => {
      expect(previousRange({ from: '2026-09-01', to: '2026-09-30' }, 'month')).toEqual({ from: '2026-08-01', to: '2026-08-30' });
    });
    it('year: shifts both bounds one year back', () => {
      expect(previousRange({ from: '2026-01-01', to: '2026-12-31' }, 'year')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });
    it('previous across a year boundary', () => {
      expect(previousRange({ from: '2026-01-01', to: '2026-01-31' }, 'previous')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    });
  });
});
