import { BadRequestException } from '@nestjs/common';

/** A single ledger line to post. */
export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  description?: string | null;
  /** Branch dimension; falls back to the entry's branch when omitted. */
  branchId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  warehouseId?: string | null;
  productId?: string | null;
}

/** Minimal account shape the line validator needs. */
export interface PostableAccount {
  id: string;
  isActive: boolean;
  allowPosting: boolean;
  isHeader: boolean;
  name: string;
}

/** Tolerance for floating-point debit/credit comparison (half a piaster). */
export const BALANCE_TOLERANCE = 0.005;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Validate the debit/credit shape of every line: a line hits exactly one side
 * with a positive amount, never both, never neither, never negative. Pure —
 * throws {@link BadRequestException} (Arabic) on the first violation.
 */
export function validateLineShapes(lines: JournalLineInput[]): void {
  if (!lines.length) {
    throw new BadRequestException('لا يمكن إنشاء قيد بدون بنود');
  }

  lines.forEach((line, index) => {
    const debit = line.debit || 0;
    const credit = line.credit || 0;
    const label = `السطر ${index + 1}`;

    if (debit < 0 || credit < 0) {
      throw new BadRequestException(`${label}: القيمة لا يمكن أن تكون سالبة`);
    }
    if (debit > 0 && credit > 0) {
      throw new BadRequestException(
        `${label}: لا يمكن إدخال مدين ودائن في نفس السطر`,
      );
    }
    if (debit === 0 && credit === 0) {
      throw new BadRequestException(`${label}: يجب إدخال مدين أو دائن`);
    }
  });
}

/**
 * Validate every referenced account exists and is postable (active, allows
 * posting, not a header/parent). `accountsById` must contain every accountId
 * used by the lines. Pure — throws on the first violation.
 */
export function validateAccounts(
  lines: JournalLineInput[],
  accountsById: Map<string, PostableAccount>,
): void {
  for (const line of lines) {
    const account = accountsById.get(line.accountId);
    if (!account) {
      throw new BadRequestException('أحد الحسابات المختارة غير موجود');
    }
    if (!account.isActive) {
      throw new BadRequestException(`الحساب "${account.name}" غير نشط`);
    }
    if (account.isHeader || !account.allowPosting) {
      throw new BadRequestException(
        `الحساب "${account.name}" حساب رئيسي ولا يقبل الترحيل`,
      );
    }
  }
}

/** Sum the lines into rounded debit/credit totals (server-authoritative). */
export function computeTotals(lines: JournalLineInput[]): {
  totalDebit: number;
  totalCredit: number;
} {
  const totalDebit = round2(
    lines.reduce((sum, l) => sum + (l.debit || 0), 0),
  );
  const totalCredit = round2(
    lines.reduce((sum, l) => sum + (l.credit || 0), 0),
  );
  return { totalDebit, totalCredit };
}

/** True when Σdebit == Σcredit within tolerance. */
export function isBalanced(totalDebit: number, totalCredit: number): boolean {
  return Math.abs(totalDebit - totalCredit) <= BALANCE_TOLERANCE;
}

/** Assert the entry balances and both sides are positive. Throws otherwise. */
export function assertPostable(
  totalDebit: number,
  totalCredit: number,
): void {
  if (totalDebit <= 0 || totalCredit <= 0) {
    throw new BadRequestException('يجب أن يكون إجمالي المدين والدائن أكبر من صفر');
  }
  if (!isBalanced(totalDebit, totalCredit)) {
    throw new BadRequestException(
      'القيد غير متوازن: إجمالي المدين لا يساوي إجمالي الدائن',
    );
  }
}

/**
 * Build the opposite lines for a reversal: debit becomes credit and vice
 * versa, dimensions preserved. Pure.
 */
export function buildReversalLines(
  lines: JournalLineInput[],
): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
    description: line.description ? `عكس: ${line.description}` : 'عكس قيد',
    customerId: line.customerId ?? null,
    supplierId: line.supplierId ?? null,
    warehouseId: line.warehouseId ?? null,
    productId: line.productId ?? null,
  }));
}
