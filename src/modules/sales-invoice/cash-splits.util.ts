import { BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { SalesCashSplit } from './entities/sales-invoice.entity';

/** Each part with its treasury / bank name, for the details page and printout. */
export async function namedCashSplits(
manager: EntityManager,
payments: { cashAccountId: string; treasuryId?: string | null; bankAccountId?: string | null; amount: number }[],
): Promise<SalesCashSplit[]> {
  const ids = payments.map((p) => p.cashAccountId);
  const [treasuries, banks] = await Promise.all([
    manager.getRepository(Treasury).find({ where: { accountId: In(ids) } }),
    manager.getRepository(BankAccount).find({ where: { accountId: In(ids) } }),
  ]);
  const bankName = (b: BankAccount) => (b.accountName ? `${b.bankName} — ${b.accountName}` : b.bankName);
  return payments.map((p) => {
    const amount = Math.round(Number(p.amount) * 100) / 100;
    // The exact treasury / bank when given (must post through the same GL account) …
    if (p.treasuryId) {
      const t = treasuries.find((x) => x.id === p.treasuryId && x.accountId === p.cashAccountId);
      if (!t) throw new BadRequestException('الخزنة غير موجودة أو لا تطابق حسابها');
      return { cashAccountId: p.cashAccountId, treasuryId: t.id, bankAccountId: null, amount, accountName: t.name };
    }
    if (p.bankAccountId) {
      const b = banks.find((x) => x.id === p.bankAccountId && x.accountId === p.cashAccountId);
      if (!b) throw new BadRequestException('الحساب البنكي غير موجود أو لا يطابق حسابه');
      return { cashAccountId: p.cashAccountId, treasuryId: null, bankAccountId: b.id, amount, accountName: bankName(b) };
    }
    // … else the first one on that GL account.
    const t = treasuries.find((x) => x.accountId === p.cashAccountId);
    const b = banks.find((x) => x.accountId === p.cashAccountId);
    if (!t && !b) throw new BadRequestException('حساب التحصيل ليس خزنة أو حساباً بنكياً');
    return t
      ? { cashAccountId: p.cashAccountId, treasuryId: t.id, bankAccountId: null, amount, accountName: t.name }
      : { cashAccountId: p.cashAccountId, treasuryId: null, bankAccountId: b!.id, amount, accountName: bankName(b!) };
  });
}
