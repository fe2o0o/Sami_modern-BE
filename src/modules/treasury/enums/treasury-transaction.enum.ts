/**
 * What produced a treasury (cashbox) subledger movement. A debit increases the
 * cash on hand, a credit decreases it. The treasury balance is derived from
 * these — never stored as a single mutable field.
 */
export enum TreasuryTransactionType {
  OPENING_BALANCE = 'opening_balance',
  RECEIPT = 'receipt',
  PAYMENT = 'payment',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  CASH_SALE = 'cash_sale',
  CASH_PURCHASE = 'cash_purchase',
  CASH_SALE_RETURN = 'cash_sale_return',
  CASH_PURCHASE_RETURN = 'cash_purchase_return',
  ADJUSTMENT = 'adjustment',
  REVERSAL = 'reversal',
}

export const TREASURY_TRANSACTION_TYPE_LABELS: Record<
  TreasuryTransactionType,
  string
> = {
  [TreasuryTransactionType.OPENING_BALANCE]: 'رصيد افتتاحي',
  [TreasuryTransactionType.RECEIPT]: 'سند قبض',
  [TreasuryTransactionType.PAYMENT]: 'سند صرف',
  [TreasuryTransactionType.TRANSFER_IN]: 'تحويل وارد',
  [TreasuryTransactionType.TRANSFER_OUT]: 'تحويل صادر',
  [TreasuryTransactionType.CASH_SALE]: 'مبيعات نقدية',
  [TreasuryTransactionType.CASH_PURCHASE]: 'مشتريات نقدية',
  [TreasuryTransactionType.CASH_SALE_RETURN]: 'مردود مبيعات نقدي',
  [TreasuryTransactionType.CASH_PURCHASE_RETURN]: 'مردود مشتريات نقدي',
  [TreasuryTransactionType.ADJUSTMENT]: 'تسوية',
  [TreasuryTransactionType.REVERSAL]: 'عكس قيد',
};
