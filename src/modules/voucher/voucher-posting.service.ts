import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Voucher } from './entities/voucher.entity';
import {
  VoucherPaymentMethod,
  VoucherStatus,
  VoucherType,
} from './enums/voucher.enum';
import { ReverseVoucherDto } from './dto/reverse-voucher.dto';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { SequenceService } from '../sequence/sequence.service';
import { CustomerLedgerService } from '../customer/customer-ledger.service';
import { CustomerTransactionType } from '../customer/enums/customer-transaction.enum';
import { SupplierLedgerService } from '../supplier/supplier-ledger.service';
import { SupplierTransactionType } from '../supplier/enums/supplier-transaction.enum';
import { TreasuryLedgerService } from '../treasury/treasury-ledger.service';
import { TreasuryTransactionType } from '../treasury/enums/treasury-transaction.enum';
import { BankLedgerService } from '../bank-account/bank-ledger.service';
import { BankTransactionType } from '../bank-account/enums/bank-transaction.enum';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

/** The cash/bank GL account + branch a voucher moves through. */
interface CashLeg {
  accountId: string;
  branchId: string | null;
  label: string;
}

/**
 * Owns the accounting/subledger side-effects of a voucher. Posting and reversal
 * each run inside ONE transaction: the journal entry, the party subledger
 * (customer/supplier) and the treasury/bank subledger all move together, or
 * nothing does. Journal rows go only through the central JournalEntryService.
 */
@Injectable()
export class VoucherPostingService {
  constructor(
    private readonly sequenceService: SequenceService,
    private readonly journalService: JournalEntryService,
    private readonly customerLedger: CustomerLedgerService,
    private readonly supplierLedger: SupplierLedgerService,
    private readonly treasuryLedger: TreasuryLedgerService,
    private readonly bankLedger: BankLedgerService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // POST
  // =========================================================
  async post(id: string, actorId?: string, branchScope: string | null = null): Promise<Voucher> {
    return this.dataSource.transaction(async (manager) => {
      const voucher = await this.lock(manager, id);
      if (branchScope && voucher.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على السند');
      }
      if (voucher.status !== VoucherStatus.DRAFT) {
        throw new BadRequestException('لا يمكن ترحيل سند غير مسودة');
      }
      if (voucher.amount <= 0) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');

      const { fiscalYear } = await this.assertOpenPostingContext(
        voucher.fiscalYearId, voucher.accountingPeriodId, voucher.voucherDate, manager,
      );
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');

      const cash = await this.resolveCashLeg(voucher, manager);
      const controlAccount = this.resolveControlAccount(voucher, settings);
      const branchId = voucher.branchId ?? cash.branchId;

      const prefix = voucher.type === VoucherType.RECEIPT ? 'RV' : 'PV';
      const voucherNumber = await this.sequenceService.nextDocumentNumber(prefix, fiscalYear, manager);
      const sourceType =
        voucher.type === VoucherType.RECEIPT
          ? JournalSourceType.RECEIPT_VOUCHER
          : JournalSourceType.PAYMENT_VOUCHER;
      const description =
        voucher.type === VoucherType.RECEIPT
          ? `سند قبض ${voucherNumber} — ${voucher.partyName ?? ''}`
          : `سند صرف ${voucherNumber} — ${voucher.partyName ?? ''}`;

      // Journal: RECEIPT → DR cash / CR customer-control; PAYMENT → DR supplier-control / CR cash.
      const lines: JournalLineInput[] =
        voucher.type === VoucherType.RECEIPT
          ? [
              { accountId: cash.accountId, debit: voucher.amount, credit: 0, description },
              { accountId: controlAccount, debit: 0, credit: voucher.amount, description },
            ]
          : [
              { accountId: controlAccount, debit: voucher.amount, credit: 0, description },
              { accountId: cash.accountId, debit: 0, credit: voucher.amount, description },
            ];
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType,
          sourceId: voucher.id,
          sourceNumber: voucherNumber,
          entryDate: voucher.voucherDate,
          fiscalYearId: voucher.fiscalYearId,
          accountingPeriodId: voucher.accountingPeriodId,
          branchId,
          description,
          lines,
          actorId,
        },
        manager,
      );

      // Party subledger.
      if (voucher.type === VoucherType.RECEIPT) {
        await this.customerLedger.record(
          {
            customerId: voucher.partyId,
            transactionDate: voucher.voucherDate,
            type: CustomerTransactionType.RECEIPT,
            sourceType,
            sourceId: voucher.id,
            sourceNumber: voucherNumber,
            debit: 0,
            credit: voucher.amount,
            description,
            actorId,
          },
          manager,
        );
      } else {
        await this.supplierLedger.record(
          {
            supplierId: voucher.partyId,
            transactionDate: voucher.voucherDate,
            type: SupplierTransactionType.PAYMENT,
            sourceType,
            sourceId: voucher.id,
            sourceNumber: voucherNumber,
            debit: voucher.amount,
            credit: 0,
            description,
            actorId,
          },
          manager,
        );
      }

      // Treasury / bank subledger (RECEIPT = money in = debit; PAYMENT = out = credit).
      const isReceipt = voucher.type === VoucherType.RECEIPT;
      await this.recordCashLeg(voucher, {
        debit: isReceipt ? voucher.amount : 0,
        credit: isReceipt ? 0 : voucher.amount,
        typeReceipt: isReceipt,
        sourceType,
        sourceNumber: voucherNumber,
        journalEntryId: journalEntry.id,
        description,
        actorId,
      }, manager);

      voucher.voucherNumber = voucherNumber;
      voucher.status = VoucherStatus.POSTED;
      voucher.journalEntryId = journalEntry.id;
      voucher.postedAt = new Date();
      voucher.postedBy = actorId ?? null;
      voucher.updatedBy = actorId ?? null;

      await manager.getRepository(Voucher).save(voucher);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // REVERSE
  // =========================================================
  async reverse(id: string, dto: ReverseVoucherDto, actorId?: string, branchScope: string | null = null): Promise<Voucher> {
    return this.dataSource.transaction(async (manager) => {
      const voucher = await this.lock(manager, id);
      if (branchScope && voucher.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على السند');
      }
      if (voucher.status === VoucherStatus.REVERSED) {
        throw new ConflictException('السند معكوس بالفعل');
      }
      if (voucher.status !== VoucherStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس سند غير مُرحّل');
      }

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = voucher.journalEntryId
        ? await this.journalService.findWithLines(voucher.journalEntryId)
        : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للسند');

      const cash = await this.resolveCashLeg(voucher, manager);
      const branchId = voucher.branchId ?? cash.branchId;

      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس سند',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType:
            voucher.type === VoucherType.RECEIPT
              ? JournalSourceType.RECEIPT_VOUCHER
              : JournalSourceType.PAYMENT_VOUCHER,
          sourceId: voucher.id,
          sourceNumber: voucher.voucherNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId,
          description: `عكس ${voucher.type === VoucherType.RECEIPT ? 'سند قبض' : 'سند صرف'} ${voucher.voucherNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      const desc = `عكس ${voucher.type === VoucherType.RECEIPT ? 'سند قبض' : 'سند صرف'} ${voucher.voucherNumber ?? ''}`;
      // Reverse the party subledger.
      if (voucher.type === VoucherType.RECEIPT) {
        await this.customerLedger.record(
          {
            customerId: voucher.partyId,
            transactionDate: dto.reversalDate,
            type: CustomerTransactionType.REVERSAL,
            sourceType: JournalSourceType.RECEIPT_VOUCHER,
            sourceId: voucher.id,
            sourceNumber: voucher.voucherNumber,
            debit: voucher.amount,
            credit: 0,
            description: desc,
            actorId,
          },
          manager,
        );
      } else {
        await this.supplierLedger.record(
          {
            supplierId: voucher.partyId,
            transactionDate: dto.reversalDate,
            type: SupplierTransactionType.REVERSAL,
            sourceType: JournalSourceType.PAYMENT_VOUCHER,
            sourceId: voucher.id,
            sourceNumber: voucher.voucherNumber,
            debit: 0,
            credit: voucher.amount,
            description: desc,
            actorId,
          },
          manager,
        );
      }

      // Reverse the treasury/bank subledger (opposite of the original leg).
      const wasReceipt = voucher.type === VoucherType.RECEIPT;
      await this.recordCashLeg(voucher, {
        debit: wasReceipt ? 0 : voucher.amount,
        credit: wasReceipt ? voucher.amount : 0,
        typeReceipt: wasReceipt,
        reversal: true,
        sourceType: wasReceipt ? JournalSourceType.RECEIPT_VOUCHER : JournalSourceType.PAYMENT_VOUCHER,
        sourceNumber: voucher.voucherNumber,
        journalEntryId: reversalEntry.id,
        description: desc,
        actorId,
        transactionDate: dto.reversalDate,
      }, manager);

      voucher.status = VoucherStatus.REVERSED;
      voucher.reversedAt = new Date();
      voucher.reversedBy = actorId ?? null;
      voucher.reversalReason = dto.reason;
      voucher.reversalJournalEntryId = reversalEntry.id;
      voucher.updatedBy = actorId ?? null;

      await manager.getRepository(Voucher).save(voucher);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private resolveControlAccount(voucher: Voucher, settings: AccountingSetting): string {
    if (voucher.type === VoucherType.RECEIPT) {
      if (!settings.customerControlAccountId) {
        throw new BadRequestException('حساب مراقبة العملاء غير محدد في إعدادات المحاسبة');
      }
      return settings.customerControlAccountId;
    }
    if (!settings.supplierControlAccountId) {
      throw new BadRequestException('حساب مراقبة الموردين غير محدد في إعدادات المحاسبة');
    }
    return settings.supplierControlAccountId;
  }

  private async resolveCashLeg(voucher: Voucher, manager: EntityManager): Promise<CashLeg> {
    if (voucher.paymentMethod === VoucherPaymentMethod.TREASURY) {
      const t = await manager.getRepository(Treasury).findOne({ where: { id: voucher.treasuryId ?? '' } });
      if (!t) throw new NotFoundException('الخزينة غير موجودة');
      return { accountId: t.accountId, branchId: t.branchId, label: t.name };
    }
    const b = await manager.getRepository(BankAccount).findOne({ where: { id: voucher.bankAccountId ?? '' } });
    if (!b) throw new NotFoundException('الحساب البنكي غير موجود');
    return { accountId: b.accountId, branchId: b.branchId, label: `${b.bankName} - ${b.accountName}` };
  }

  private async recordCashLeg(
    voucher: Voucher,
    opts: {
      debit: number;
      credit: number;
      typeReceipt: boolean;
      reversal?: boolean;
      sourceType: string;
      sourceNumber: string | null;
      journalEntryId: string;
      description: string;
      actorId?: string;
      transactionDate?: string;
    },
    manager: EntityManager,
  ): Promise<void> {
    const transactionDate = opts.transactionDate ?? voucher.voucherDate;
    const base = {
      transactionDate,
      sourceType: opts.sourceType,
      sourceId: voucher.id,
      sourceNumber: opts.sourceNumber,
      debit: opts.debit,
      credit: opts.credit,
      description: opts.description,
      journalEntryId: opts.journalEntryId,
      actorId: opts.actorId,
    };
    if (voucher.paymentMethod === VoucherPaymentMethod.TREASURY) {
      const type = opts.reversal
        ? TreasuryTransactionType.REVERSAL
        : opts.typeReceipt
          ? TreasuryTransactionType.RECEIPT
          : TreasuryTransactionType.PAYMENT;
      await this.treasuryLedger.record({ treasuryId: voucher.treasuryId!, type, ...base }, manager);
    } else {
      const type = opts.reversal
        ? BankTransactionType.REVERSAL
        : opts.typeReceipt
          ? BankTransactionType.RECEIPT
          : BankTransactionType.PAYMENT;
      await this.bankLedger.record({ bankAccountId: voucher.bankAccountId!, type, ...base }, manager);
    }
  }

  private async lock(manager: EntityManager, id: string): Promise<Voucher> {
    const voucher = await manager.findOne(Voucher, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!voucher) throw new NotFoundException('لم يتم العثور على السند');
    return voucher;
  }

  private reload(manager: EntityManager, id: string): Promise<Voucher> {
    return manager.findOne(Voucher, { where: { id } }) as Promise<Voucher>;
  }

  private async assertOpenPostingContext(
    fiscalYearId: string,
    accountingPeriodId: string,
    entryDate: string,
    manager: EntityManager,
  ): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id: accountingPeriodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYear.id) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
    if (period.isClosed) throw new BadRequestException('لا يمكن الترحيل إلى فترة محاسبية مغلقة');
    this.assertDateWithin(entryDate, period.startDate, period.endDate, 'تاريخ السند خارج نطاق الفترة المحاسبية');
    return { fiscalYear, period };
  }

  private async getOpenPeriod(id: string, manager: EntityManager): Promise<AccountingPeriod> {
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id } });
    if (!period) throw new NotFoundException('الفترة المحاسبية للعكس غير موجودة');
    if (period.isClosed) throw new BadRequestException('الفترة المحاسبية للعكس مغلقة، يرجى اختيار فترة مفتوحة');
    return period;
  }

  private assertDateWithin(date: string, start: string, end: string, message: string): void {
    const d = new Date(date).getTime();
    if (d < new Date(start).getTime() || d > new Date(end).getTime()) {
      throw new BadRequestException(message);
    }
  }
}
