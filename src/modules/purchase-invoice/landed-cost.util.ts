import { round2 } from '../sales-invoice/sales-math';

/** How one landed expense (freight, loading …) is spread over the invoice lines. */
export enum LandedAllocation {
  /** In proportion to each line's net value (after discount, before VAT). */
  VALUE = 'value',
  /** In proportion to each line's quantity. */
  QUANTITY = 'quantity',
  /** All of it on one line (`targetLineNumber`). */
  LINE = 'line',
}

/**
 * A cost added onto the purchased goods (مصاريف محمّلة). Paid from a treasury or
 * bank when the invoice is posted — through a payment voucher (`voucherId`) that
 * posting creates — and capitalised into the lines' cost.
 */
export interface PurchaseLandedExpense {
  description: string;
  amount: number;
  allocation: LandedAllocation;
  /** LINE allocation: the invoice line (its 1-based line number) that carries it. */
  targetLineNumber?: number | null;
  /** Exactly one of the two: where the money is paid from. */
  treasuryId?: string | null;
  bankAccountId?: string | null;
  /** Set when posted: the payment voucher that paid it. */
  voucherId?: string | null;
  voucherNumber?: string | null;
}

interface AllocatableLine {
  lineNumber: number;
  quantity: number;
  netBeforeTax: number;
}

/**
 * Split every expense over the lines → landed cost per line number. Each expense is
 * rounded to the piaster and its rounding remainder lands on the last weighted line,
 * so Σ shares = Σ expenses exactly. A VALUE/QUANTITY expense over lines that all
 * weigh 0 falls back to an even split.
 */
export function allocateLandedCosts(lines: AllocatableLine[], expenses: PurchaseLandedExpense[]): Map<number, number> {
  const out = new Map<number, number>(lines.map((l) => [l.lineNumber, 0]));
  for (const e of expenses) {
    const amount = round2(Number(e.amount) || 0);
    if (amount <= 0 || !lines.length) continue;
    if (e.allocation === LandedAllocation.LINE) {
      const n = Number(e.targetLineNumber);
      if (out.has(n)) out.set(n, round2(out.get(n)! + amount));
      continue;
    }
    const weightOf = (l: AllocatableLine) =>
      Math.max(e.allocation === LandedAllocation.QUANTITY ? Number(l.quantity) || 0 : Number(l.netBeforeTax) || 0, 0);
    let weights = lines.map(weightOf);
    if (weights.every((w) => w === 0)) weights = lines.map(() => 1);
    const total = weights.reduce((s, w) => s + w, 0);
    const lastIdx = weights.reduce((last, w, i) => (w > 0 ? i : last), 0);
    let given = 0;
    lines.forEach((l, i) => {
      if (weights[i] <= 0) return;
      const share = i === lastIdx ? round2(amount - given) : round2((amount * weights[i]) / total);
      given = round2(given + share);
      out.set(l.lineNumber, round2(out.get(l.lineNumber)! + share));
    });
  }
  return out;
}

/** Σ amount of the expenses. */
export function landedTotal(expenses: PurchaseLandedExpense[] | null | undefined): number {
  return round2((expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0));
}
