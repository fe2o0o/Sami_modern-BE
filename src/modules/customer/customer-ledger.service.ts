import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CustomerTransaction } from './entities/customer-transaction.entity';
import { CustomerTransactionType } from './enums/customer-transaction.enum';

/** One customer subledger movement to record. */
export interface CustomerLedgerEntry {
  customerId: string;
  transactionDate: string;
  type: CustomerTransactionType;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
  actorId?: string | null;
}

export interface CustomerStatement {
  balance: number;
  transactions: CustomerTransaction[];
}

/**
 * Party-level receivable ledger. The general ledger only carries the aggregated
 * customer control account; this service keeps the per-customer detail so a
 * customer statement / balance can be produced without a GL account per
 * customer. All writes join the caller's transaction.
 */
@Injectable()
export class CustomerLedgerService {
  constructor(
    @InjectRepository(CustomerTransaction)
    private readonly repository: Repository<CustomerTransaction>,
  ) {}

  /** Append one movement inside the caller's transaction. */
  async record(
    entry: CustomerLedgerEntry,
    manager: EntityManager,
  ): Promise<CustomerTransaction> {
    const repo = manager.getRepository(CustomerTransaction);
    return repo.save(
      repo.create({
        customerId: entry.customerId,
        transactionDate: entry.transactionDate,
        type: entry.type,
        sourceType: entry.sourceType ?? null,
        sourceId: entry.sourceId ?? null,
        sourceNumber: entry.sourceNumber ?? null,
        debit: entry.debit ?? 0,
        credit: entry.credit ?? 0,
        description: entry.description ?? null,
        createdBy: entry.actorId ?? null,
      }),
    );
  }

  /** Current receivable balance = Σdebit − Σcredit (debit-positive). */
  async balance(customerId: string): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(t.credit), 0)', 'c')
      .where('t.customerId = :customerId', { customerId })
      .getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.d ?? 0) - Number(row?.c ?? 0));
  }

  /** Current balances for many customers in one query (0 for those with no movements). */
  async balances(customerIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>(customerIds.map((id) => [id, 0]));
    if (!customerIds.length) return map;
    const rows = await this.repository
      .createQueryBuilder('t')
      .select('t.customerId', 'id')
      .addSelect('COALESCE(SUM(t.debit - t.credit), 0)', 'b')
      .where('t.customerId IN (:...ids)', { ids: customerIds })
      .groupBy('t.customerId')
      .getRawMany<{ id: string; b: string }>();
    for (const r of rows) map.set(r.id, round2(Number(r.b)));
    return map;
  }

  /** Full statement for a customer, newest first, with the running balance. */
  async statement(customerId: string): Promise<CustomerStatement> {
    const transactions = await this.repository.find({
      where: { customerId },
      order: { transactionDate: 'DESC', createdAt: 'DESC' },
    });
    return { balance: await this.balance(customerId), transactions };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
