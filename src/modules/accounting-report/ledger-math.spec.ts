import {
  amountOf,
  runningBalances,
  sideOf,
  splitNet,
} from './ledger-math';

describe('ledger-math', () => {
  describe('sideOf', () => {
    it('positive net → DEBIT', () => expect(sideOf(7000)).toBe('DEBIT'));
    it('negative net → CREDIT', () => expect(sideOf(-8000)).toBe('CREDIT'));
    it('zero net → ZERO', () => expect(sideOf(0)).toBe('ZERO'));
    it('sub-piaster net → ZERO', () => expect(sideOf(0.004)).toBe('ZERO'));
  });

  describe('splitNet (trial-balance columns)', () => {
    it('puts a positive net in debit only', () =>
      expect(splitNet(7000)).toEqual({ debit: 7000, credit: 0 }));
    it('puts a negative net in credit only', () =>
      expect(splitNet(-8000)).toEqual({ debit: 0, credit: 8000 }));
    it('never shows both sides for the same balance', () => {
      const s = splitNet(5000);
      expect(s.debit > 0 && s.credit > 0).toBe(false);
    });
    it('zero net → both zero', () =>
      expect(splitNet(0)).toEqual({ debit: 0, credit: 0 }));
  });

  describe('runningBalances', () => {
    it('accumulates from the opening net and reports the side each row', () => {
      // Cash: opening 0, then Dr 5000, Dr 3000, Cr 1000 → 5000, 8000, 7000
      const result = runningBalances(0, [
        { debit: 5000, credit: 0 },
        { debit: 3000, credit: 0 },
        { debit: 0, credit: 1000 },
      ]);
      expect(result.map((r) => r.runningBalance)).toEqual([5000, 8000, 7000]);
      expect(result.map((r) => r.runningBalanceSide)).toEqual([
        'DEBIT',
        'DEBIT',
        'DEBIT',
      ]);
    });

    it('reversal nets a debit-then-credit to zero', () => {
      const result = runningBalances(0, [
        { debit: 5000, credit: 0 },
        { debit: 0, credit: 5000 },
      ]);
      expect(result[1]).toEqual({ runningBalance: 0, runningBalanceSide: 'ZERO' });
    });

    it('stays continuous across pagination (page 2 seeded by brought-forward)', () => {
      const all = [
        { debit: 5000, credit: 0 },
        { debit: 3000, credit: 0 },
        { debit: 0, credit: 1000 },
        { debit: 0, credit: 2000 },
      ];
      // Page 1 (rows 0-1) seeded from opening 0.
      const page1 = runningBalances(0, all.slice(0, 2));
      // Brought-forward into page 2 = opening + Σ(net of rows 0-1) = 8000.
      const broughtForward = 0 + (5000 - 0) + (3000 - 0);
      const page2 = runningBalances(broughtForward, all.slice(2));
      // The full single-page computation must match the paginated stitch.
      const full = runningBalances(0, all);
      expect([...page1, ...page2].map((r) => r.runningBalance)).toEqual(
        full.map((r) => r.runningBalance),
      );
      expect(page2.at(-1)!.runningBalance).toBe(5000);
    });

    it('credit-normal account reads CREDIT as it accrues', () => {
      // Supplier control: Cr 8000 → net -8000 → CREDIT 8000
      const result = runningBalances(0, [{ debit: 0, credit: 8000 }]);
      expect(result[0]).toEqual({ runningBalance: 8000, runningBalanceSide: 'CREDIT' });
    });
  });

  describe('amountOf', () => {
    it('is the absolute value', () => {
      expect(amountOf(-8000)).toBe(8000);
      expect(amountOf(7000)).toBe(7000);
    });
  });
});
