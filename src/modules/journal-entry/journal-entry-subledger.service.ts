import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { CustomerLedgerService } from '../customer/customer-ledger.service';
import { SupplierLedgerService } from '../supplier/supplier-ledger.service';
import { TreasuryLedgerService } from '../treasury/treasury-ledger.service';
import { BankLedgerService } from '../bank-account/bank-ledger.service';
import { CustomerTransactionType } from '../customer/enums/customer-transaction.enum';
import { SupplierTransactionType } from '../supplier/enums/supplier-transaction.enum';
import { TreasuryTransactionType } from '../treasury/enums/treasury-transaction.enum';
import { BankTransactionType } from '../bank-account/enums/bank-transaction.enum';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { JournalLineInput } from './journal-entry.rules';

/** Subledger a journal line belongs to, resolved from its account/party. */
export type JournalPartyKind = 'customer' | 'supplier' | 'treasury' | 'bank';

export interface LinePartyInfo {
  partyType: JournalPartyKind | null;
  partyId: string | null;
  partyName: string | null;
}

/** Source type stamped on subledger rows written from a manual journal entry. */
export const MANUAL_JOURNAL_SOURCE = 'journal_entry';

/**
 * Keeps MANUAL journal entries in step with the party subledgers. System
 * documents (invoices, vouchers…) write their own subledger rows; a manual entry
 * that hits the customer/supplier control account or a treasury/bank GL account
 * would otherwise change the general ledger while the customer statement or
 * cashbox never hears about it. So:
 *
 *  - a line on the customer control account MUST name a customer (and a
 *    customer may only be named there); same for suppliers;
 *  - on post, every party line is mirrored as an ADJUSTMENT row on that party's
 *    ledger, and cash/bank lines are mirrored on the treasury/bank ledger whose
 *    GL account they hit (resolved exactly like {@link CashSubledgerService});
 *  - on reversal the mirrored rows are written again with the sides swapped.
 *
 * Everything joins the caller's transaction.
 */
@Injectable()
export class JournalEntrySubledgerService {
  constructor(
    private readonly customerLedger: CustomerLedgerService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly treasuryLedger: TreasuryLedgerService,
    private readonly bankLedger: BankLedgerService,
  ) {}

  /**
   * Party ↔ account rules for manual lines. `requireParty` is enforced at post
   * time only; a draft may still be missing the customer/supplier.
   */
  async validate(lines: JournalLineInput[], manager: EntityManager, opts: { requireParty: boolean }): Promise<void> {
    const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
    const customerControl = settings?.customerControlAccountId ?? null;
    const supplierControl = settings?.supplierControlAccountId ?? null;

    lines.forEach((line, index) => {
      const label = `السطر ${index + 1}`;
      if (line.customerId && line.supplierId) {
        throw new BadRequestException(`${label}: لا يمكن ربط عميل ومورد في نفس السطر`);
      }
      if (line.customerId) {
        if (!customerControl) throw new BadRequestException('حساب مراقبة العملاء غير محدد في إعدادات المحاسبة');
        if (line.accountId !== customerControl) {
          throw new BadRequestException(`${label}: لا يمكن ربط عميل إلا بحساب مراقبة العملاء`);
        }
      }
      if (line.supplierId) {
        if (!supplierControl) throw new BadRequestException('حساب مراقبة الموردين غير محدد في إعدادات المحاسبة');
        if (line.accountId !== supplierControl) {
          throw new BadRequestException(`${label}: لا يمكن ربط مورد إلا بحساب مراقبة الموردين`);
        }
      }
      if (opts.requireParty) {
        if (customerControl && line.accountId === customerControl && !line.customerId) {
          throw new BadRequestException(`${label}: حساب مراقبة العملاء يتطلب اختيار العميل ليظهر القيد في كشف حسابه`);
        }
        if (supplierControl && line.accountId === supplierControl && !line.supplierId) {
          throw new BadRequestException(`${label}: حساب مراقبة الموردين يتطلب اختيار المورد ليظهر القيد في كشف حسابه`);
        }
      }
    });

    const customerIds = [...new Set(lines.map((l) => l.customerId).filter((v): v is string => !!v))];
    if (customerIds.length) {
      const found = await manager.getRepository(Customer).count({ where: { id: In(customerIds) } });
      if (found !== customerIds.length) throw new BadRequestException('أحد العملاء المختارين غير موجود');
    }
    const supplierIds = [...new Set(lines.map((l) => l.supplierId).filter((v): v is string => !!v))];
    if (supplierIds.length) {
      const found = await manager.getRepository(Supplier).count({ where: { id: In(supplierIds) } });
      if (found !== supplierIds.length) throw new BadRequestException('أحد الموردين المختارين غير موجود');
    }
  }

  /**
   * Mirror a posted manual entry into the subledgers. `lines` are the lines as
   * posted (for a reversal entry: already swapped), so debit/credit are copied
   * as-is and only the row TYPE says whether this is an adjustment or a reversal.
   */
  async record(
    entry: JournalEntry,
    lines: JournalLineInput[],
    manager: EntityManager,
    opts: { reversal: boolean; actorId?: string | null },
  ): Promise<void> {
    const cashByAccount = new Map<string, { treasuryId?: string; bankAccountId?: string } | null>();
    const resolveCash = async (accountId: string) => {
      if (cashByAccount.has(accountId)) return cashByAccount.get(accountId)!;
      const treasury = await manager.getRepository(Treasury).findOne({ where: { accountId }, order: { isActive: 'DESC' } });
      let hit: { treasuryId?: string; bankAccountId?: string } | null = treasury ? { treasuryId: treasury.id } : null;
      if (!hit) {
        const bank = await manager.getRepository(BankAccount).findOne({ where: { accountId }, order: { isActive: 'DESC' } });
        hit = bank ? { bankAccountId: bank.id } : null;
      }
      cashByAccount.set(accountId, hit);
      return hit;
    };

    for (const line of lines) {
      const amount = { debit: line.debit || 0, credit: line.credit || 0 };
      if (amount.debit <= 0 && amount.credit <= 0) continue;
      const base = {
        transactionDate: entry.entryDate,
        sourceType: MANUAL_JOURNAL_SOURCE,
        sourceId: entry.id,
        sourceNumber: entry.entryNumber,
        description: line.description || entry.description || `قيد يومية ${entry.entryNumber ?? ''}`,
        actorId: opts.actorId ?? null,
        ...amount,
      };

      if (line.customerId) {
        await this.customerLedger.record(
          { customerId: line.customerId, type: opts.reversal ? CustomerTransactionType.REVERSAL : CustomerTransactionType.ADJUSTMENT, ...base },
          manager,
        );
        continue;
      }
      if (line.supplierId) {
        await this.supplierLedger.record(
          { supplierId: line.supplierId, type: opts.reversal ? SupplierTransactionType.REVERSAL : SupplierTransactionType.ADJUSTMENT, ...base },
          manager,
        );
        continue;
      }
      const cash = await resolveCash(line.accountId);
      if (cash?.treasuryId) {
        await this.treasuryLedger.record(
          { treasuryId: cash.treasuryId, type: opts.reversal ? TreasuryTransactionType.REVERSAL : TreasuryTransactionType.ADJUSTMENT, journalEntryId: entry.id, ...base },
          manager,
        );
      } else if (cash?.bankAccountId) {
        await this.bankLedger.record(
          { bankAccountId: cash.bankAccountId, type: opts.reversal ? BankTransactionType.REVERSAL : BankTransactionType.ADJUSTMENT, journalEntryId: entry.id, ...base },
          manager,
        );
      }
      // else: a plain GL account — nothing to mirror.
    }
  }

  /** Party display info per line (same order as `lines`) for the details view. */
  async describe(lines: JournalEntryLine[], manager: EntityManager): Promise<LinePartyInfo[]> {
    const customerIds = [...new Set(lines.map((l) => l.customerId).filter((v): v is string => !!v))];
    const supplierIds = [...new Set(lines.map((l) => l.supplierId).filter((v): v is string => !!v))];
    const accountIds = [...new Set(lines.filter((l) => !l.customerId && !l.supplierId).map((l) => l.accountId))];

    const [customers, suppliers, treasuries, banks] = await Promise.all([
      customerIds.length ? manager.getRepository(Customer).find({ where: { id: In(customerIds) }, select: { id: true, name: true }, withDeleted: true }) : Promise.resolve([] as Customer[]),
      supplierIds.length ? manager.getRepository(Supplier).find({ where: { id: In(supplierIds) }, select: { id: true, name: true }, withDeleted: true }) : Promise.resolve([] as Supplier[]),
      accountIds.length ? manager.getRepository(Treasury).find({ where: { accountId: In(accountIds) }, select: { id: true, name: true, accountId: true } }) : Promise.resolve([] as Treasury[]),
      accountIds.length ? manager.getRepository(BankAccount).find({ where: { accountId: In(accountIds) }, select: { id: true, bankName: true, accountName: true, accountId: true } }) : Promise.resolve([] as BankAccount[]),
    ]);
    const cName = new Map<string, string>(customers.map((c) => [c.id, c.name]));
    const sName = new Map<string, string>(suppliers.map((s) => [s.id, s.name]));
    const tByAcc = new Map<string, Treasury>(treasuries.map((t) => [t.accountId, t]));
    const bByAcc = new Map<string, BankAccount>(banks.map((b) => [b.accountId, b]));

    return lines.map((l): LinePartyInfo => {
      if (l.customerId) return { partyType: 'customer', partyId: l.customerId, partyName: cName.get(l.customerId) ?? null };
      if (l.supplierId) return { partyType: 'supplier', partyId: l.supplierId, partyName: sName.get(l.supplierId) ?? null };
      const t = tByAcc.get(l.accountId);
      if (t) return { partyType: 'treasury', partyId: t.id, partyName: t.name };
      const b = bByAcc.get(l.accountId);
      if (b) return { partyType: 'bank', partyId: b.id, partyName: `${b.bankName} - ${b.accountName}` };
      return { partyType: null, partyId: null, partyName: null };
    });
  }
}
