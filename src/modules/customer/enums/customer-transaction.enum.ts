/**
 * What produced a customer subledger movement. The subledger tracks the
 * party-level receivable balance; the general ledger only ever sees the
 * aggregated customer control account.
 */
export enum CustomerTransactionType {
  OPENING_BALANCE = 'opening_balance',
  SALES_INVOICE = 'sales_invoice',
  SALES_RETURN = 'sales_return',
  RECEIPT = 'receipt',
  ADJUSTMENT = 'adjustment',
  REVERSAL = 'reversal',
}

export const CUSTOMER_TRANSACTION_TYPE_LABELS: Record<
  CustomerTransactionType,
  string
> = {
  [CustomerTransactionType.OPENING_BALANCE]: 'رصيد افتتاحي',
  [CustomerTransactionType.SALES_INVOICE]: 'فاتورة مبيعات',
  [CustomerTransactionType.SALES_RETURN]: 'مردود مبيعات',
  [CustomerTransactionType.RECEIPT]: 'سند قبض',
  [CustomerTransactionType.ADJUSTMENT]: 'تسوية',
  [CustomerTransactionType.REVERSAL]: 'عكس قيد',
};
