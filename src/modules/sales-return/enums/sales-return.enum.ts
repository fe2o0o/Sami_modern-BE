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

/**
 * Returned manufacturing quantity that was never delivered — what happens to its
 * production order:
 *  STOP     → the order is stopped (shrunk, or cancelled when nothing is left;
 *             a fee already booked to the factory is reduced / reversed);
 *  CONTINUE → the order goes on; the produced item stays in the warehouse as stock.
 */
export enum ReturnManufacturingAction {
  STOP = 'stop',
  CONTINUE = 'continue',
}

export const SALES_RETURN_STATUS_LABELS: Record<SalesReturnStatus, string> = {
  [SalesReturnStatus.DRAFT]: 'مسودة',
  [SalesReturnStatus.POSTED]: 'مُرحّل',
  [SalesReturnStatus.REVERSED]: 'معكوس',
};
