/**
 * Lifecycle of a sales invoice.
 * DRAFT   → editable, ZERO stock/subledger/accounting effect.
 * POSTED  → immutable; inventory issued, customer subledger + journal created.
 * REVERSED→ immutable; a posted invoice undone by opposite effects (history kept).
 * CANCELLED→ a draft that was cancelled (never posted).
 */
export enum SalesInvoiceStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
  CANCELLED = 'cancelled',
}

/** How the sale is settled. CREDIT → receivable; CASH → cash/bank account. */
export enum SalesPaymentType {
  CREDIT = 'credit',
  CASH = 'cash',
}

/**
 * Delivery progress of a POSTED invoice's stock lines (goods are reserved at
 * post, then shipped via delivery notes). Manufacturing-only invoices stay
 * NOT_APPLICABLE.
 */
export enum SalesDeliveryStatus {
  NOT_APPLICABLE = 'not_applicable',
  PENDING = 'pending',
  PARTIAL = 'partial',
  DELIVERED = 'delivered',
}

export const SALES_DELIVERY_STATUS_LABELS: Record<SalesDeliveryStatus, string> = {
  [SalesDeliveryStatus.NOT_APPLICABLE]: 'لا ينطبق',
  [SalesDeliveryStatus.PENDING]: 'بانتظار التسليم',
  [SalesDeliveryStatus.PARTIAL]: 'مُسلّم جزئياً',
  [SalesDeliveryStatus.DELIVERED]: 'مُسلّم بالكامل',
};

export enum SalesDiscountType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

/**
 * How an invoice line is fulfilled.
 * STOCK        → sold from inventory (issues stock, recognizes COGS).
 * MANUFACTURING→ made-to-order: no stock/COGS effect; posting the invoice
 *                creates a linked manufacturing (production) order with the
 *                customer's specification.
 */
export enum SalesLineType {
  STOCK = 'stock',
  MANUFACTURING = 'manufacturing',
}

export const SALES_LINE_TYPE_LABELS: Record<SalesLineType, string> = {
  [SalesLineType.STOCK]: 'من المخزن',
  [SalesLineType.MANUFACTURING]: 'تصنيع',
};

/** How an employee's sales commission on an invoice is calculated. */
export enum SalesCommissionType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export const SALES_COMMISSION_TYPE_LABELS: Record<SalesCommissionType, string> = {
  [SalesCommissionType.PERCENTAGE]: 'نسبة %',
  [SalesCommissionType.FIXED]: 'مبلغ ثابت',
};

export const SALES_INVOICE_STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  [SalesInvoiceStatus.DRAFT]: 'مسودة',
  [SalesInvoiceStatus.POSTED]: 'مرحّلة',
  [SalesInvoiceStatus.REVERSED]: 'معكوسة',
  [SalesInvoiceStatus.CANCELLED]: 'ملغاة',
};

export const SALES_PAYMENT_TYPE_LABELS: Record<SalesPaymentType, string> = {
  [SalesPaymentType.CREDIT]: 'آجل',
  [SalesPaymentType.CASH]: 'نقدي',
};
