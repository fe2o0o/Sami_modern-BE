/**
 * Lifecycle of a manufacturing (production) order. A production request that
 * tracks HOW a made-to-order product should be produced for a customer. It has
 * NO stock or accounting effect — it is a documentary/tracking record, usually
 * linked to the sales invoice line that requested it.
 *
 * NEW         → just created / requested.
 * IN_PROGRESS → production started.
 * DONE        → production finished (ready for delivery).
 * CANCELLED   → request cancelled.
 */
export enum ManufacturingOrderStatus {
  NEW = 'new',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export const MANUFACTURING_ORDER_STATUS_LABELS: Record<
  ManufacturingOrderStatus,
  string
> = {
  [ManufacturingOrderStatus.NEW]: 'جديد',
  [ManufacturingOrderStatus.IN_PROGRESS]: 'قيد التنفيذ',
  [ManufacturingOrderStatus.DONE]: 'تم التنفيذ',
  [ManufacturingOrderStatus.CANCELLED]: 'ملغى',
};
