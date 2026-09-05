/**
 * Lifecycle of a delivery note (إذن تسليم). A delivery note is what physically
 * issues stock out of the warehouse and books the cost of sales; a linked
 * sales invoice only reserved the goods.
 * DRAFT   → editable, no stock/accounting effect.
 * POSTED  → immutable; stock issued, COGS journal created, reservation released.
 * REVERSED→ immutable; undone by opposite effects (history kept).
 */
export enum SalesDeliveryStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const SALES_DELIVERY_STATUS_LABELS: Record<SalesDeliveryStatus, string> = {
  [SalesDeliveryStatus.DRAFT]: 'مسودة',
  [SalesDeliveryStatus.POSTED]: 'مُرحّل',
  [SalesDeliveryStatus.REVERSED]: 'معكوس',
};

/** Where a delivery note's lines come from. */
export enum SalesDeliverySource {
  /** Fulfils a posted sales invoice (releases its reservation). */
  INVOICE = 'invoice',
  /** Ad-hoc goods issue with no invoice (stock + COGS only). */
  STANDALONE = 'standalone',
}

export const SALES_DELIVERY_SOURCE_LABELS: Record<SalesDeliverySource, string> = {
  [SalesDeliverySource.INVOICE]: 'من فاتورة',
  [SalesDeliverySource.STANDALONE]: 'مستند مستقل',
};
