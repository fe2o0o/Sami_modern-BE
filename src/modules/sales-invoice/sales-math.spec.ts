import { computeInvoice, computeLine } from './sales-math';

describe('sales-math', () => {
  describe('computeLine', () => {
    it('2 chairs @ 1500, 14% VAT, no discount', () => {
      const t = computeLine({
        quantity: 2,
        unitPrice: 1500,
        discountType: 'fixed',
        discountValue: 0,
        vatRate: 14,
      });
      expect(t).toEqual({
        gross: 3000,
        discountAmount: 0,
        netBeforeTax: 3000,
        vatAmount: 420,
        lineTotal: 3420,
      });
    });

    it('applies VAT AFTER discount, not before', () => {
      // 10000 gross, 500 fixed discount → 9500 taxable, 14% → 1330 VAT
      const t = computeLine({
        quantity: 1,
        unitPrice: 10000,
        discountType: 'fixed',
        discountValue: 500,
        vatRate: 14,
      });
      expect(t.netBeforeTax).toBe(9500);
      expect(t.vatAmount).toBe(1330);
      expect(t.lineTotal).toBe(10830);
    });

    it('percentage discount', () => {
      const t = computeLine({
        quantity: 1,
        unitPrice: 1000,
        discountType: 'percentage',
        discountValue: 10,
        vatRate: 0,
      });
      expect(t.discountAmount).toBe(100);
      expect(t.netBeforeTax).toBe(900);
      expect(t.vatAmount).toBe(0);
    });

    it('caps a discount at the gross and floors it at zero', () => {
      const over = computeLine({
        quantity: 1,
        unitPrice: 100,
        discountType: 'fixed',
        discountValue: 999,
        vatRate: 0,
      });
      expect(over.discountAmount).toBe(100);
      expect(over.netBeforeTax).toBe(0);
    });

    it('0% VAT line', () => {
      const t = computeLine({
        quantity: 3,
        unitPrice: 200,
        discountType: 'fixed',
        discountValue: 0,
        vatRate: 0,
      });
      expect(t.vatAmount).toBe(0);
      expect(t.lineTotal).toBe(600);
    });
  });

  describe('computeInvoice', () => {
    it('aggregates the first sales test scenario', () => {
      const { totals } = computeInvoice([
        { quantity: 2, unitPrice: 1500, discountType: 'fixed', discountValue: 0, vatRate: 14 },
      ]);
      expect(totals).toEqual({
        subtotal: 3000,
        discountAmount: 0,
        taxableAmount: 3000,
        vatAmount: 420,
        totalAmount: 3420,
      });
    });

    it('sums a mixed-rate, discounted invoice', () => {
      const { totals } = computeInvoice([
        { quantity: 1, unitPrice: 10000, discountType: 'fixed', discountValue: 500, vatRate: 14 },
        { quantity: 2, unitPrice: 250, discountType: 'percentage', discountValue: 0, vatRate: 0 },
      ]);
      expect(totals.subtotal).toBe(10500);
      expect(totals.discountAmount).toBe(500);
      expect(totals.taxableAmount).toBe(10000);
      expect(totals.vatAmount).toBe(1330);
      expect(totals.totalAmount).toBe(11330);
    });
  });
});
