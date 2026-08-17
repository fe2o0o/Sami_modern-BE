/**
 * A voucher records cash movement against a party:
 * RECEIPT → money IN from a customer (settles a receivable).
 * PAYMENT → money OUT to a supplier (settles a payable).
 */
export enum VoucherType {
  RECEIPT = 'receipt',
  PAYMENT = 'payment',
}

/** How the money moves — through a cash treasury or a bank account. */
export enum VoucherPaymentMethod {
  TREASURY = 'treasury',
  BANK = 'bank',
}

/**
 * DRAFT   → editable, ZERO accounting/subledger effect.
 * POSTED  → immutable; journal + party subledger + treasury/bank subledger created.
 * REVERSED→ immutable; undone by opposite effects (history kept).
 */
export enum VoucherStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  [VoucherType.RECEIPT]: 'سند قبض',
  [VoucherType.PAYMENT]: 'سند صرف',
};

export const VOUCHER_PAYMENT_METHOD_LABELS: Record<VoucherPaymentMethod, string> = {
  [VoucherPaymentMethod.TREASURY]: 'خزينة',
  [VoucherPaymentMethod.BANK]: 'بنك',
};

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  [VoucherStatus.DRAFT]: 'مسودة',
  [VoucherStatus.POSTED]: 'مُرحّل',
  [VoucherStatus.REVERSED]: 'معكوس',
};
