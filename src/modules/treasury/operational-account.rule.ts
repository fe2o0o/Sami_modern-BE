import { BadRequestException } from '@nestjs/common';
import {
  AccountSubType,
  AccountType,
} from '../chart-of-account/enums/account.enum';

/**
 * The chart-of-account fields an operational entity (treasury, bank account)
 * needs to validate its GL mapping.
 */
export interface OperationalAccountInfo {
  isActive: boolean;
  allowPosting: boolean;
  isHeader: boolean;
  accountType: AccountType;
  accountSubType: AccountSubType | null;
  name: string;
}

/**
 * Assert a chart-of-account is a valid GL mapping for an operational cash/bank
 * entity: it must exist, be active, be a posting leaf (never a parent/header),
 * be of the required type (ASSET) and carry the required sub-type (CASH for a
 * treasury, BANK for a bank account). This deliberately blocks revenue/expense/
 * inventory/receivable/payable accounts. Pure — throws {@link BadRequestException}.
 */
export function assertOperationalAccount(
  account: OperationalAccountInfo | undefined | null,
  opts: {
    allowedType: AccountType;
    allowedSubTypes: AccountSubType[];
    /** e.g. "الخزينة" / "الحساب البنكي" */
    label: string;
    /** e.g. "حساب نقدية" / "حساب بنك" */
    kind: string;
  },
): void {
  if (!account) {
    throw new BadRequestException('الحساب المحاسبي المختار غير موجود');
  }
  if (!account.isActive) {
    throw new BadRequestException(`الحساب "${account.name}" غير نشط`);
  }
  if (account.isHeader || !account.allowPosting) {
    throw new BadRequestException(
      `الحساب "${account.name}" حساب رئيسي ولا يقبل الترحيل`,
    );
  }
  if (account.accountType !== opts.allowedType) {
    throw new BadRequestException(
      `يجب أن يكون الحساب المحاسبي لـ${opts.label} ${opts.kind}`,
    );
  }
  if (!account.accountSubType || !opts.allowedSubTypes.includes(account.accountSubType)) {
    throw new BadRequestException(
      `يجب أن يكون الحساب المحاسبي لـ${opts.label} ${opts.kind} (مصنّف بشكل صحيح في شجرة الحسابات)`,
    );
  }
}
