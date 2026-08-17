import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BankTransaction } from './entities/bank-transaction.entity';
import { BankTransactionType } from './enums/bank-transaction.enum';

export interface BankLedgerEntry {
  bankAccountId: string;
  transactionDate: string;
  type: BankTransactionType;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
  journalEntryId?: string | null;
  actorId?: string | null;
}

export interface BankStatement {
  balance: number;
  transactions: BankTransaction[];
}

/**
 * Operational ledger for bank accounts. GL carries the aggregated bank account;
 * per-account detail lives here. All writes join the caller's transaction.
 */
@Injectable()
export class BankLedgerService {
  constructor(
    @InjectRepository(BankTransaction)
    private readonly repository: Repository<BankTransaction>,
  ) {}

  async record(entry: BankLedgerEntry, manager: EntityManager): Promise<BankTransaction> {
    const repo = manager.getRepository(BankTransaction);
    return repo.save(
      repo.create({
        bankAccountId: entry.bankAccountId,
        transactionDate: entry.transactionDate,
        type: entry.type,
        sourceType: entry.sourceType ?? null,
        sourceId: entry.sourceId ?? null,
        sourceNumber: entry.sourceNumber ?? null,
        debit: entry.debit ?? 0,
        credit: entry.credit ?? 0,
        description: entry.description ?? null,
        journalEntryId: entry.journalEntryId ?? null,
        createdBy: entry.actorId ?? null,
      }),
    );
  }

  async balance(bankAccountId: string): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(t.credit), 0)', 'c')
      .where('t.bankAccountId = :bankAccountId', { bankAccountId })
      .getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.d ?? 0) - Number(row?.c ?? 0));
  }

  async statement(bankAccountId: string): Promise<BankStatement> {
    const transactions = await this.repository.find({
      where: { bankAccountId },
      order: { transactionDate: 'DESC', createdAt: 'DESC' },
    });
    return { balance: await this.balance(bankAccountId), transactions };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
