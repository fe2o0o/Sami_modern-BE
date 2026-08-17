/** Direction of a stock adjustment line. */
export enum AdjustmentType {
  INCREASE = 'increase',
  DECREASE = 'decrease',
}

/**
 * DRAFT   → editable, ZERO stock/accounting effect.
 * POSTED  → immutable; stock moved + one journal entry created.
 * REVERSED→ immutable; undone by opposite effects.
 */
export enum InventoryAdjustmentStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentType, string> = {
  [AdjustmentType.INCREASE]: 'زيادة',
  [AdjustmentType.DECREASE]: 'عجز',
};

export const INVENTORY_ADJUSTMENT_STATUS_LABELS: Record<InventoryAdjustmentStatus, string> = {
  [InventoryAdjustmentStatus.DRAFT]: 'مسودة',
  [InventoryAdjustmentStatus.POSTED]: 'مُرحّل',
  [InventoryAdjustmentStatus.REVERSED]: 'معكوس',
};
