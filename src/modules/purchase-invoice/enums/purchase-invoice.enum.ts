/**
 * Lifecycle of a purchase invoice.
 * DRAFT   → editable, ZERO stock/subledger/accounting effect.
 * POSTED  → immutable; inventory received, supplier subledger + journal created.
 * REVERSED→ immutable; a posted invoice undone by opposite effects (history kept).
 * CANCELLED→ a draft that was cancelled (never posted).
 */
export enum PurchaseInvoiceStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
  CANCELLED = 'cancelled',
}

/** How the purchase is settled. CREDIT → payable; CASH → cash/bank account. */
export enum PurchasePaymentType {
  CREDIT = 'credit',
  CASH = 'cash',
}

export enum PurchaseDiscountType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export const PURCHASE_INVOICE_STATUS_LABELS: Record<
  PurchaseInvoiceStatus,
  string
> = {
  [PurchaseInvoiceStatus.DRAFT]: 'مسودة',
  [PurchaseInvoiceStatus.POSTED]: 'مرحّلة',
  [PurchaseInvoiceStatus.REVERSED]: 'معكوسة',
  [PurchaseInvoiceStatus.CANCELLED]: 'ملغاة',
};

export const PURCHASE_PAYMENT_TYPE_LABELS: Record<PurchasePaymentType, string> = {
  [PurchasePaymentType.CREDIT]: 'آجل',
  [PurchasePaymentType.CASH]: 'نقدي',
};
