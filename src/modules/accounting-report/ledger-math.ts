/**
 * Pure, decimal-safe accounting math shared by the General Ledger and Trial
 * Balance reports. No database, no framework — so it is trivially unit-tested
 * and guarantees both reports agree on how a net balance becomes a
 * debit/credit presentation.
 */

/** Which side a net balance falls on. */
export type BalanceSide = 'DEBIT' | 'CREDIT' | 'ZERO';

/** Half-a-piaster tolerance for treating a net as zero. */
export const MONEY_TOLERANCE = 0.005;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * The side of a signed net balance where net = Σdebit − Σcredit. A positive net
 * sits on the DEBIT side, a negative net on the CREDIT side. This is driven by
 * the actual posted movement, not the account's "normal" side, so an overdrawn
 * asset correctly reads CREDIT.
 */
export function sideOf(net: number): BalanceSide {
  const n = round2(net);
  if (Math.abs(n) < MONEY_TOLERANCE) return 'ZERO';
  return n > 0 ? 'DEBIT' : 'CREDIT';
}

/** Absolute presentation amount of a net balance (always ≥ 0). */
export function amountOf(net: number): number {
  return round2(Math.abs(net));
}

/**
 * Split a signed net into the single debit/credit column it belongs in — never
 * both. Used for the Trial Balance opening/closing columns.
 */
export function splitNet(net: number): { debit: number; credit: number } {
  const n = round2(net);
  if (n > MONEY_TOLERANCE) return { debit: round2(n), credit: 0 };
  if (n < -MONEY_TOLERANCE) return { debit: 0, credit: round2(-n) };
  return { debit: 0, credit: 0 };
}

export interface LedgerMovement {
  debit: number;
  credit: number;
}

export interface RunningBalance {
  runningBalance: number;
  runningBalanceSide: BalanceSide;
}

/**
 * Compute the running balance after each movement, seeded by `openingNet` (the
 * balance brought forward BEFORE the first row — which, under pagination, is
 * the opening balance plus every movement on earlier pages). Returns one entry
 * per input row, in order.
 */
export function runningBalances(
  openingNet: number,
  rows: LedgerMovement[],
): RunningBalance[] {
  let net = round2(openingNet);
  return rows.map((row) => {
    net = round2(net + (row.debit || 0) - (row.credit || 0));
    return { runningBalance: amountOf(net), runningBalanceSide: sideOf(net) };
  });
}
