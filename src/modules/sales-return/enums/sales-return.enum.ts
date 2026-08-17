/**
 * DRAFT   → editable, ZERO stock/accounting effect.
 * POSTED  → immutable; returned goods received back, journal + customer subledger created.
 * REVERSED→ immutable; undone by opposite effects.
 */
export enum SalesReturnStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const SALES_RETURN_STATUS_LABELS: Record<SalesReturnStatus, string> = {
  [SalesReturnStatus.DRAFT]: 'مسودة',
  [SalesReturnStatus.POSTED]: 'مُرحّل',
  [SalesReturnStatus.REVERSED]: 'معكوس',
};
