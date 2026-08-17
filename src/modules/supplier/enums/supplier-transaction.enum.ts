/**
 * What produced a supplier subledger movement. The subledger tracks the
 * party-level payable balance; the general ledger only ever sees the aggregated
 * supplier control account.
 */
export enum SupplierTransactionType {
  OPENING_BALANCE = 'opening_balance',
  PURCHASE_INVOICE = 'purchase_invoice',
  PURCHASE_RETURN = 'purchase_return',
  PAYMENT = 'payment',
  ADJUSTMENT = 'adjustment',
  REVERSAL = 'reversal',
}

export const SUPPLIER_TRANSACTION_TYPE_LABELS: Record<
  SupplierTransactionType,
  string
> = {
  [SupplierTransactionType.OPENING_BALANCE]: 'رصيد افتتاحي',
  [SupplierTransactionType.PURCHASE_INVOICE]: 'فاتورة مشتريات',
  [SupplierTransactionType.PURCHASE_RETURN]: 'مردود مشتريات',
  [SupplierTransactionType.PAYMENT]: 'سند صرف',
  [SupplierTransactionType.ADJUSTMENT]: 'تسوية',
  [SupplierTransactionType.REVERSAL]: 'عكس قيد',
};
