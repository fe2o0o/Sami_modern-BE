/**
 * DRAFT   → editable, no stock effect.
 * POSTED  → immutable; quantities moved from source to destination warehouse.
 * REVERSED→ immutable; the move undone.
 */
export enum StockTransferStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const STOCK_TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  [StockTransferStatus.DRAFT]: 'مسودة',
  [StockTransferStatus.POSTED]: 'مُرحّل',
  [StockTransferStatus.REVERSED]: 'معكوس',
};
