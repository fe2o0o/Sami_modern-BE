import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { TreasuryLedgerService } from '../treasury/treasury-ledger.service';
import { BankLedgerService } from '../bank-account/bank-ledger.service';
import { TreasuryTransactionType } from '../treasury/enums/treasury-transaction.enum';
import { BankTransactionType } from '../bank-account/enums/bank-transaction.enum';
import { JournalEntryService } from '../journal-entry/journal-entry.service';
import { JournalEntry } from '../journal-entry/entities/journal-entry.entity';
import { JournalLineInput } from '../journal-entry/journal-entry.rules';
import { HrCashMethod } from './enums/advance.enum';

export interface HrCashRef {
  method: HrCashMethod;
  treasuryId?: string | null;
  bankAccountId?: string | null;
}

export interface HrCashLeg {
  accountId: string;
  branchId: string | null;
  label: string;
}

/**
 * Shared posting plumbing for HR money documents (advances, custody): the open
 * period of a date, the treasury/bank leg, the cashbook row and the standard
 * reversal (opposite entry, same dimensions incl. the employee).
 */
@Injectable()
export class HrPostingHelper {
  constructor(
    private readonly journals: JournalEntryService,
    private readonly treasuryLedger: TreasuryLedgerService,
    private readonly bankLedger: BankLedgerService,
  ) {}

  /** The open accounting period (and open fiscal year) that contains `date`. */
  async context(date: string, manager: EntityManager): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const period = await manager
      .getRepository(AccountingPeriod)
      .createQueryBuilder('p')
      .where('p.startDate <= :d AND p.endDate >= :d', { d: date })
      .getOne();
    if (!period) throw new BadRequestException(`لا توجد فترة محاسبية تشمل التاريخ ${date}`);
    if (period.isClosed) throw new BadRequestException('الفترة المحاسبية لهذا التاريخ مغلقة');
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: period.fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    return { fiscalYear, period };
  }

  /** Employee advances / custody accounts from the accounting settings. */
  async accounts(manager: EntityManager): Promise<{ settings: AccountingSetting; advances: string | null; custody: string | null }> {
    const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
    if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
    return { settings, advances: settings.employeeAdvancesAccountId, custody: settings.employeeCustodyAccountId };
  }

  async cashLeg(ref: HrCashRef, manager: EntityManager): Promise<HrCashLeg> {
    if (ref.method === HrCashMethod.TREASURY) {
      const t = await manager.getRepository(Treasury).findOne({ where: { id: ref.treasuryId ?? '' } });
      if (!t) throw new NotFoundException('الخزينة غير موجودة');
      if (!t.isActive) throw new BadRequestException('الخزينة المختارة موقوفة');
      return { accountId: t.accountId, branchId: t.branchId, label: t.name };
    }
    const b = await manager.getRepository(BankAccount).findOne({ where: { id: ref.bankAccountId ?? '' } });
    if (!b) throw new NotFoundException('الحساب البنكي غير موجود');
    if (!b.isActive) throw new BadRequestException('الحساب البنكي المختار موقوف');
    return { accountId: b.accountId, branchId: null, label: `${b.bankName} - ${b.accountName}` };
  }

  /** One cashbook row on the treasury / bank (debit = money in). */
  async recordCash(
    ref: HrCashRef,
    row: {
      date: string;
      moneyIn: boolean;
      amount: number;
      reversal?: boolean;
      sourceType: string;
      sourceId: string;
      sourceNumber: string | null;
      journalEntryId: string;
      description: string;
      actorId?: string | null;
    },
    manager: EntityManager,
  ): Promise<void> {
    const base = {
      transactionDate: row.date,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceNumber: row.sourceNumber,
      debit: row.moneyIn ? row.amount : 0,
      credit: row.moneyIn ? 0 : row.amount,
      description: row.description,
      journalEntryId: row.journalEntryId,
      actorId: row.actorId ?? undefined,
    };
    if (ref.method === HrCashMethod.TREASURY) {
      const type = row.reversal ? TreasuryTransactionType.REVERSAL : row.moneyIn ? TreasuryTransactionType.RECEIPT : TreasuryTransactionType.PAYMENT;
      await this.treasuryLedger.record({ treasuryId: ref.treasuryId!, type, ...base }, manager);
    } else {
      const type = row.reversal ? BankTransactionType.REVERSAL : row.moneyIn ? BankTransactionType.RECEIPT : BankTransactionType.PAYMENT;
      await this.bankLedger.record({ bankAccountId: ref.bankAccountId!, type, ...base }, manager);
    }
  }

  /** Opposite entry of `journalEntryId` on `date` (lines swapped, dimensions kept), original marked reversed. */
  async reverseEntry(
    journalEntryId: string,
    opts: { date: string; reason: string; sourceType: string; sourceId: string; sourceNumber: string | null; description: string; actorId?: string | null },
    manager: EntityManager,
  ): Promise<JournalEntry> {
    const original = await manager.getRepository(JournalEntry).findOne({ where: { id: journalEntryId }, relations: { lines: true } });
    if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي');
    const { period } = await this.context(opts.date, manager);
    const lines: JournalLineInput[] = original.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
      description: l.description ? `عكس: ${l.description}` : 'عكس',
      branchId: l.branchId,
      employeeId: l.employeeId,
      productId: l.productId,
      warehouseId: l.warehouseId,
    }));
    const reversal = await this.journals.createSystemJournalEntry(
      {
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        sourceNumber: opts.sourceNumber,
        entryDate: opts.date,
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: period.id,
        branchId: original.branchId,
        description: opts.description,
        reversalOfJournalEntryId: original.id,
        lines,
        actorId: opts.actorId ?? null,
      },
      manager,
    );
    await this.journals.markEntryReversed(original.id, reversal.id, opts.reason, opts.actorId ?? undefined, manager);
    return reversal;
  }
}
