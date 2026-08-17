/** Direction of a stock movement relative to the warehouse. */
export enum StockDirection {
  IN = 'in',
  OUT = 'out',
}

/** What produced a stock movement. */
export enum StockMovementType {
  OPENING = 'opening',
  OPENING_REVERSAL = 'opening_reversal',
  PURCHASE = 'purchase',
  PURCHASE_RETURN = 'purchase_return',
  SALE = 'sale',
  SALE_RETURN = 'sale_return',
  SALE_REVERSAL = 'sale_reversal',
  ADJUSTMENT = 'adjustment',
  TRANSFER = 'transfer',
  MANUFACTURING = 'manufacturing',
}

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  [StockMovementType.OPENING]: 'رصيد افتتاحي',
  [StockMovementType.OPENING_REVERSAL]: 'عكس رصيد افتتاحي',
  [StockMovementType.PURCHASE]: 'شراء',
  [StockMovementType.PURCHASE_RETURN]: 'مردود مشتريات',
  [StockMovementType.SALE]: 'بيع',
  [StockMovementType.SALE_RETURN]: 'مردود مبيعات',
  [StockMovementType.SALE_REVERSAL]: 'عكس فاتورة مبيعات',
  [StockMovementType.ADJUSTMENT]: 'تسوية',
  [StockMovementType.TRANSFER]: 'تحويل',
  [StockMovementType.MANUFACTURING]: 'تصنيع',
};
