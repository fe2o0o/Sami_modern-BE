/**
 * Pure, decimal-safe sales/line arithmetic. The backend is authoritative for
 * every total — Angular only mirrors this for a live preview. The order is
 * strict: gross → discount → net (taxable) → VAT → line total, so VAT is never
 * charged on the discounted-away amount.
 */

export type DiscountType = 'percentage' | 'fixed';

export interface SalesLineInput {
  quantity: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
  /** VAT rate as a percentage, e.g. 14 for 14%. */
  vatRate: number;
}

export interface SalesLineTotals {
  gross: number;
  discountAmount: number;
  netBeforeTax: number;
  vatAmount: number;
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Compute one line's money breakdown. */
export function computeLine(line: SalesLineInput): SalesLineTotals {
  const quantity = line.quantity || 0;
  const unitPrice = line.unitPrice || 0;
  const gross = round2(quantity * unitPrice);

  const rawDiscount =
    line.discountType === 'percentage'
      ? (gross * (line.discountValue || 0)) / 100
      : line.discountValue || 0;
  // A discount can never exceed the gross or be negative.
  const discountAmount = round2(Math.min(Math.max(rawDiscount, 0), gross));

  const netBeforeTax = round2(gross - discountAmount);
  const vatAmount = round2((netBeforeTax * (line.vatRate || 0)) / 100);
  const lineTotal = round2(netBeforeTax + vatAmount);

  return { gross, discountAmount, netBeforeTax, vatAmount, lineTotal };
}

/** Aggregate lines into the invoice-level totals. */
export function computeInvoice(lines: SalesLineInput[]): {
  lines: SalesLineTotals[];
  totals: InvoiceTotals;
} {
  const computed = lines.map(computeLine);
  const sum = (pick: (t: SalesLineTotals) => number): number =>
    round2(computed.reduce((acc, t) => acc + pick(t), 0));

  const subtotal = sum((t) => t.gross);
  const discountAmount = sum((t) => t.discountAmount);
  const taxableAmount = sum((t) => t.netBeforeTax);
  const vatAmount = sum((t) => t.vatAmount);
  const totalAmount = round2(taxableAmount + vatAmount);

  return {
    lines: computed,
    totals: { subtotal, discountAmount, taxableAmount, vatAmount, totalAmount },
  };
}
