/**
 * What produced a bank-account subledger movement. Debit increases the bank
 * balance, credit decreases it. Balance is derived from these rows.
 */
export enum BankTransactionType {
  OPENING_BALANCE = 'opening_balance',
  RECEIPT = 'receipt',
  PAYMENT = 'payment',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  BANK_FEE = 'bank_fee',
  ADJUSTMENT = 'adjustment',
  REVERSAL = 'reversal',
}

export const BANK_TRANSACTION_TYPE_LABELS: Record<BankTransactionType, string> = {
  [BankTransactionType.OPENING_BALANCE]: 'رصيد افتتاحي',
  [BankTransactionType.RECEIPT]: 'إيداع / تحصيل',
  [BankTransactionType.PAYMENT]: 'سحب / دفع',
  [BankTransactionType.TRANSFER_IN]: 'تحويل وارد',
  [BankTransactionType.TRANSFER_OUT]: 'تحويل صادر',
  [BankTransactionType.BANK_FEE]: 'مصاريف بنكية',
  [BankTransactionType.ADJUSTMENT]: 'تسوية',
  [BankTransactionType.REVERSAL]: 'عكس قيد',
};
