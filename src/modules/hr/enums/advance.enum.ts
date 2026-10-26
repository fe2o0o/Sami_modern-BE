/** Employee advance (سلفة) lifecycle. */
export enum AdvanceStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  PAID = 'paid',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
  REVERSED = 'reversed',
}

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  [AdvanceStatus.DRAFT]: 'مسودة',
  [AdvanceStatus.APPROVED]: 'معتمدة',
  [AdvanceStatus.PAID]: 'مصروفة',
  [AdvanceStatus.SETTLED]: 'مسددة',
  [AdvanceStatus.CANCELLED]: 'ملغاة',
  [AdvanceStatus.REVERSED]: 'معكوسة',
};

export enum InstallmentStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
}

/** Employee custody (عهدة) lifecycle. */
export enum CustodyStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PARTIAL = 'partial',
  SETTLED = 'settled',
  REVERSED = 'reversed',
}

export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = {
  [CustodyStatus.DRAFT]: 'مسودة',
  [CustodyStatus.OPEN]: 'مفتوحة',
  [CustodyStatus.PARTIAL]: 'مسوّاة جزئياً',
  [CustodyStatus.SETTLED]: 'مسوّاة',
  [CustodyStatus.REVERSED]: 'معكوسة',
};

/** How a custody is settled: cash returned to a treasury/bank, or expenses spent. */
export enum CustodySettlementType {
  CASH_RETURN = 'cash_return',
  EXPENSES = 'expenses',
}

/** Where money is paid from / returned to. */
export enum HrCashMethod {
  TREASURY = 'treasury',
  BANK = 'bank',
}

/** A posted employee movement (repayment / settlement) can be reversed. */
export enum HrMovementStatus {
  POSTED = 'posted',
  REVERSED = 'reversed',
}
