import { BadRequestException } from '@nestjs/common';
import { assertOperationalAccount, OperationalAccountInfo } from './operational-account.rule';
import { AccountSubType, AccountType } from '../chart-of-account/enums/account.enum';

const acct = (over: Partial<OperationalAccountInfo> = {}): OperationalAccountInfo => ({
  isActive: true,
  allowPosting: true,
  isHeader: false,
  accountType: AccountType.ASSET,
  accountSubType: AccountSubType.CASH,
  name: 'النقدية بالصندوق',
  ...over,
});

const CASH_OPTS = {
  allowedType: AccountType.ASSET,
  allowedSubTypes: [AccountSubType.CASH],
  label: 'الخزينة',
  kind: 'حساب نقدية',
};

describe('assertOperationalAccount', () => {
  it('accepts an active cash posting account', () => {
    expect(() => assertOperationalAccount(acct(), CASH_OPTS)).not.toThrow();
  });

  it('rejects a missing account', () => {
    expect(() => assertOperationalAccount(null, CASH_OPTS)).toThrow(BadRequestException);
  });

  it('rejects an inactive account', () => {
    expect(() => assertOperationalAccount(acct({ isActive: false }), CASH_OPTS)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a parent/header account', () => {
    expect(() =>
      assertOperationalAccount(acct({ isHeader: true, allowPosting: false }), CASH_OPTS),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-asset (e.g. revenue) account', () => {
    expect(() =>
      assertOperationalAccount(
        acct({ accountType: AccountType.REVENUE, accountSubType: AccountSubType.SALES_REVENUE }),
        CASH_OPTS,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an asset that is not a cash sub-type (e.g. inventory)', () => {
    expect(() =>
      assertOperationalAccount(
        acct({ accountSubType: AccountSubType.INVENTORY_FINISHED_GOODS }),
        CASH_OPTS,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an unclassified asset account (null sub-type)', () => {
    expect(() => assertOperationalAccount(acct({ accountSubType: null }), CASH_OPTS)).toThrow(
      BadRequestException,
    );
  });

  it('validates a bank account against the BANK sub-type', () => {
    const BANK_OPTS = {
      allowedType: AccountType.ASSET,
      allowedSubTypes: [AccountSubType.BANK],
      label: 'الحساب البنكي',
      kind: 'حساب بنك',
    };
    expect(() =>
      assertOperationalAccount(acct({ accountSubType: AccountSubType.BANK }), BANK_OPTS),
    ).not.toThrow();
    expect(() => assertOperationalAccount(acct({ accountSubType: AccountSubType.CASH }), BANK_OPTS)).toThrow(
      BadRequestException,
    );
  });
});
