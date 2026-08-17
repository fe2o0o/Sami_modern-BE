/**
 * DRAFT   → editable, ZERO stock/accounting effect.
 * POSTED  → immutable; returned goods issued out, journal + supplier subledger created.
 * REVERSED→ immutable; undone by opposite effects.
 */
export enum PurchaseReturnStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const PURCHASE_RETURN_STATUS_LABELS: Record<PurchaseReturnStatus, string> = {
  [PurchaseReturnStatus.DRAFT]: 'مسودة',
  [PurchaseReturnStatus.POSTED]: 'مُرحّل',
  [PurchaseReturnStatus.REVERSED]: 'معكوس',
};
