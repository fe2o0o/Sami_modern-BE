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

/**
 * Fulfilment progress of a delivery ORDER (one per invoice). Independent of the
 * document lifecycle (`status`): lines are confirmed one-by-one, and this rolls
 * up their progress.
 */
export enum SalesDeliveryProgress {
  /** No line delivered yet. */
  PENDING = 'pending',
  /** Some quantity delivered, but not all. */
  PARTIAL = 'partial',
  /** Every stock line fully delivered. */
  DELIVERED = 'delivered',
}

export const SALES_DELIVERY_PROGRESS_LABELS: Record<SalesDeliveryProgress, string> = {
  [SalesDeliveryProgress.PENDING]: 'غير مسلّم',
  [SalesDeliveryProgress.PARTIAL]: 'مسلّم جزئياً',
  [SalesDeliveryProgress.DELIVERED]: 'تم التسليم',
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
