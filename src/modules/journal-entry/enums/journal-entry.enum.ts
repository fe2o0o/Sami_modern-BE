/**
 * Lifecycle of a journal entry.
 *
 * DRAFT   → editable, does NOT affect the ledger / trial balance.
 * POSTED  → immutable, affects the ledger.
 * REVERSED→ immutable; a posted entry that has been reversed by an opposite
 *           entry. Its lines STILL count in the ledger (original + reversal net
 *           to zero); the status is only a lifecycle marker. Reports read
 *           `isPosted = true`, which is true for both POSTED and REVERSED.
 */
export enum JournalEntryStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

/**
 * The kind of business document that produced a journal entry. Stored as a
 * string so historical values stay stable. Only MANUAL entries are created and
 * edited from the Journal Entries UI; every other value is written by the module
 * that owns the source document (opening balances now; sales, purchases, …).
 */
export enum JournalSourceType {
  MANUAL = 'manual',
  OPENING_BALANCE = 'opening_balance',
  OPENING_BALANCE_REVERSAL = 'opening_balance_reversal',
  SALES_INVOICE = 'sales_invoice',
  SALES_DELIVERY = 'sales_delivery',
  SALES_RETURN = 'sales_return',
  PURCHASE_INVOICE = 'purchase_invoice',
  PURCHASE_RETURN = 'purchase_return',
  RECEIPT_VOUCHER = 'receipt_voucher',
  PAYMENT_VOUCHER = 'payment_voucher',
  CASH_TRANSFER = 'cash_transfer',
  BANK_TRANSFER = 'bank_transfer',
  INVENTORY_ADJUSTMENT = 'inventory_adjustment',
  PAYROLL = 'payroll',
}

export const JOURNAL_ENTRY_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  [JournalEntryStatus.DRAFT]: 'مسودة',
  [JournalEntryStatus.POSTED]: 'مُرحّل',
  [JournalEntryStatus.REVERSED]: 'معكوس',
};

export const JOURNAL_SOURCE_TYPE_LABELS: Record<JournalSourceType, string> = {
  [JournalSourceType.MANUAL]: 'قيد يدوي',
  [JournalSourceType.OPENING_BALANCE]: 'رصيد افتتاحي',
  [JournalSourceType.OPENING_BALANCE_REVERSAL]: 'عكس رصيد افتتاحي',
  [JournalSourceType.SALES_INVOICE]: 'فاتورة مبيعات',
  [JournalSourceType.SALES_DELIVERY]: 'إذن تسليم',
  [JournalSourceType.SALES_RETURN]: 'مردود مبيعات',
  [JournalSourceType.PURCHASE_INVOICE]: 'فاتورة مشتريات',
  [JournalSourceType.PURCHASE_RETURN]: 'مردود مشتريات',
  [JournalSourceType.RECEIPT_VOUCHER]: 'سند قبض',
  [JournalSourceType.PAYMENT_VOUCHER]: 'سند صرف',
  [JournalSourceType.CASH_TRANSFER]: 'تحويل نقدي',
  [JournalSourceType.BANK_TRANSFER]: 'تحويل بنكي',
  [JournalSourceType.INVENTORY_ADJUSTMENT]: 'تسوية مخزون',
  [JournalSourceType.PAYROLL]: 'رواتب',
};

/**
 * Source types owned by another module. Entries with these types cannot be
 * created, edited, deleted or reversed from the Journal Entries UI — the source
 * document owns that lifecycle. Everything except MANUAL is system-generated.
 */
export const SYSTEM_SOURCE_TYPES: readonly string[] = Object.values(
  JournalSourceType,
).filter((t) => t !== JournalSourceType.MANUAL);

/** True when the entry's source document (not the Journal UI) owns it. */
export function isSystemSourceType(sourceType: string): boolean {
  return SYSTEM_SOURCE_TYPES.includes(sourceType);
}
