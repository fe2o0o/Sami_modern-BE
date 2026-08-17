import { BadRequestException } from '@nestjs/common';
import {
  assertPostable,
  buildReversalLines,
  computeTotals,
  isBalanced,
  JournalLineInput,
  PostableAccount,
  validateAccounts,
  validateLineShapes,
} from './journal-entry.rules';

const account = (over: Partial<PostableAccount> = {}): PostableAccount => ({
  id: 'a1',
  isActive: true,
  allowPosting: true,
  isHeader: false,
  name: 'حساب',
  ...over,
});

const line = (over: Partial<JournalLineInput> = {}): JournalLineInput => ({
  accountId: 'a1',
  debit: 0,
  credit: 0,
  ...over,
});

describe('journal-entry rules', () => {
  describe('computeTotals (server-authoritative)', () => {
    it('sums debit and credit independently and rounds to 2dp', () => {
      const totals = computeTotals([
        line({ accountId: 'cash', debit: 5000 }),
        line({ accountId: 'equity', credit: 5000 }),
      ]);
      expect(totals).toEqual({ totalDebit: 5000, totalCredit: 5000 });
    });
  });

  describe('validateLineShapes', () => {
    it('accepts a balanced two-line entry', () => {
      expect(() =>
        validateLineShapes([
          line({ debit: 100 }),
          line({ accountId: 'a2', credit: 100 }),
        ]),
      ).not.toThrow();
    });

    it('rejects an empty entry', () => {
      expect(() => validateLineShapes([])).toThrow(BadRequestException);
    });

    it('rejects a line with both debit and credit', () => {
      expect(() =>
        validateLineShapes([line({ debit: 100, credit: 100 })]),
      ).toThrow(BadRequestException);
    });

    it('rejects a zero-value line', () => {
      expect(() => validateLineShapes([line({ debit: 0, credit: 0 })])).toThrow(
        BadRequestException,
      );
    });

    it('rejects a negative amount', () => {
      expect(() => validateLineShapes([line({ debit: -5 })])).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateAccounts', () => {
    const lines = [line({ accountId: 'a1', debit: 100 })];

    it('accepts an active posting leaf account', () => {
      const map = new Map([['a1', account()]]);
      expect(() => validateAccounts(lines, map)).not.toThrow();
    });

    it('rejects a missing account', () => {
      expect(() => validateAccounts(lines, new Map())).toThrow(
        BadRequestException,
      );
    });

    it('rejects an inactive account', () => {
      const map = new Map([['a1', account({ isActive: false })]]);
      expect(() => validateAccounts(lines, map)).toThrow(BadRequestException);
    });

    it('rejects a parent/header account', () => {
      const map = new Map([['a1', account({ isHeader: true, allowPosting: false })]]);
      expect(() => validateAccounts(lines, map)).toThrow(BadRequestException);
    });
  });

  describe('assertPostable', () => {
    it('accepts equal positive totals', () => {
      expect(() => assertPostable(5000, 5000)).not.toThrow();
    });

    it('rejects unbalanced totals', () => {
      expect(() => assertPostable(5000, 4000)).toThrow(BadRequestException);
    });

    it('rejects zero totals', () => {
      expect(() => assertPostable(0, 0)).toThrow(BadRequestException);
    });

    it('tolerates sub-piaster rounding noise', () => {
      expect(isBalanced(5000, 5000.004)).toBe(true);
      expect(isBalanced(5000, 5000.01)).toBe(false);
    });
  });

  describe('buildReversalLines', () => {
    it('swaps debit and credit and preserves dimensions', () => {
      const reversal = buildReversalLines([
        line({ accountId: 'cash', debit: 5000, customerId: 'c1' }),
        line({ accountId: 'equity', credit: 5000 }),
      ]);
      expect(reversal[0]).toMatchObject({
        accountId: 'cash',
        debit: 0,
        credit: 5000,
        customerId: 'c1',
      });
      expect(reversal[1]).toMatchObject({
        accountId: 'equity',
        debit: 5000,
        credit: 0,
      });
    });
  });
});
