/** Monthly payroll run (مسير الرواتب) lifecycle. */
export enum PayrollStatus {
  /** Being prepared — recalculated / adjusted freely, no accounting. */
  DRAFT = 'draft',
  /** Approved by finance and posted to the ledger (salaries payable recognised). */
  APPROVED = 'approved',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
  /** Posting undone (only before any salary was paid). */
  REVERSED = 'reversed',
}

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  [PayrollStatus.DRAFT]: 'مسودة',
  [PayrollStatus.APPROVED]: 'معتمد',
  [PayrollStatus.PARTIALLY_PAID]: 'مصروف جزئياً',
  [PayrollStatus.PAID]: 'مصروف',
  [PayrollStatus.REVERSED]: 'معكوس',
};

/** Manual one-off line on a payroll line. */
export enum PayrollAdjustmentKind {
  /** Adds to pay (مكافأة). */
  BONUS = 'bonus',
  /** Takes from pay (جزاء). */
  PENALTY = 'penalty',
}

/** One pay component resolved on a payroll line (snapshot — editable while draft). */
export interface PayrollLineComponent {
  payComponentId: string;
  code: string;
  name: string;
  /** earning | deduction */
  componentType: string;
  isBasic: boolean;
  /** GL override from the component (falls back to the payroll settings). */
  accountId: string | null;
  amount: number;
}

export interface PayrollLineAdjustment {
  kind: PayrollAdjustmentKind;
  amount: number;
  note: string | null;
}

/** An advance installment recovered by this payroll line. */
export interface PayrollAdvanceAllocation {
  advanceId: string;
  advanceNumber: string | null;
  installmentId: string;
  dueMonth: string;
  amount: number;
}

export interface PayrollCommissionDetail {
  invoices: number;
  earned: number;
  returned: number;
}
