import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { TreasuryTransaction } from './entities/treasury-transaction.entity';
import { TreasuryTransactionType } from './enums/treasury-transaction.enum';

/** One treasury subledger movement to record. */
export interface TreasuryLedgerEntry {
  treasuryId: string;
  transactionDate: string;
  type: TreasuryTransactionType;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
  journalEntryId?: string | null;
  actorId?: string | null;
}

export interface TreasuryStatement {
  balance: number;
  transactions: TreasuryTransaction[];
}

/**
 * Operational cash ledger for treasuries. The GL only carries the aggregated
 * cash account; per-treasury cash detail lives here so a treasury balance /
 * statement can be produced. All writes join the caller's transaction.
 */
@Injectable()
export class TreasuryLedgerService {
  constructor(
    @InjectRepository(TreasuryTransaction)
    private readonly repository: Repository<TreasuryTransaction>,
  ) {}

  async record(
    entry: TreasuryLedgerEntry,
    manager: EntityManager,
  ): Promise<TreasuryTransaction> {
    const repo = manager.getRepository(TreasuryTransaction);
    return repo.save(
      repo.create({
        treasuryId: entry.treasuryId,
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

  /** Cash on hand = Σdebit − Σcredit. */
  async balance(treasuryId: string): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(t.credit), 0)', 'c')
      .where('t.treasuryId = :treasuryId', { treasuryId })
      .getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.d ?? 0) - Number(row?.c ?? 0));
  }

  async statement(treasuryId: string): Promise<TreasuryStatement> {
    const transactions = await this.repository.find({
      where: { treasuryId },
      order: { transactionDate: 'DESC', createdAt: 'DESC' },
    });
    return { balance: await this.balance(treasuryId), transactions };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
