/**
 * Lifecycle of an opening balance.
 * POSTED is read-only; it can only move to REVERSED (never back to DRAFT).
 * REVERSED is terminal — corrections are made via a new copied DRAFT.
 */
export enum OpeningBalanceStatus {
  DRAFT = 'draft',
  VALIDATED = 'validated',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

/** sourceType values written on generated journal entries / stock movements. */
export const OB_SOURCE_TYPE = 'opening_balance';
export const OB_REVERSAL_SOURCE_TYPE = 'opening_balance_reversal';

/**
 * What a detail row represents. Drives which columns are meaningful and,
 * later, how each row is posted:
 *  - GENERAL_LEDGER / CASH / BANK → posted directly against `accountId`
 *  - CUSTOMER / SUPPLIER          → posted against the control account from
 *                                   accounting settings (future module)
 *  - INVENTORY                    → posted against inventory account + stock
 *                                   ledger (future module)
 */
export enum OpeningBalanceReferenceType {
  GENERAL_LEDGER = 'general_ledger',
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
  INVENTORY = 'inventory',
  CASH = 'cash',
  BANK = 'bank',
}

/** Reference types that post directly to their own account in V1. */
export const ACCOUNT_BEARING_TYPES: readonly OpeningBalanceReferenceType[] = [
  OpeningBalanceReferenceType.GENERAL_LEDGER,
  OpeningBalanceReferenceType.CASH,
  OpeningBalanceReferenceType.BANK,
];

export const OPENING_BALANCE_STATUS_LABELS: Record<
  OpeningBalanceStatus,
  string
> = {
  [OpeningBalanceStatus.DRAFT]: 'مسودة',
  [OpeningBalanceStatus.VALIDATED]: 'تم التحقق',
  [OpeningBalanceStatus.POSTED]: 'مُرحّل',
  [OpeningBalanceStatus.REVERSED]: 'معكوس',
};
