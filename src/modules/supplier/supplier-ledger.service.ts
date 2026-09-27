import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SupplierTransaction } from './entities/supplier-transaction.entity';
import { SupplierTransactionType } from './enums/supplier-transaction.enum';

/** One supplier subledger movement to record. */
export interface SupplierLedgerEntry {
  supplierId: string;
  transactionDate: string;
  type: SupplierTransactionType;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceNumber?: string | null;
  debit?: number;
  credit?: number;
  description?: string | null;
  actorId?: string | null;
}

export interface SupplierStatement {
  balance: number;
  transactions: SupplierTransaction[];
}

/**
 * Party-level payable ledger. The general ledger only carries the aggregated
 * supplier control account; this service keeps the per-supplier detail so a
 * supplier statement / balance can be produced without a GL account per
 * supplier. All writes join the caller's transaction.
 */
@Injectable()
export class SupplierLedgerService {
  constructor(
    @InjectRepository(SupplierTransaction)
    private readonly repository: Repository<SupplierTransaction>,
  ) {}

  /** Append one movement inside the caller's transaction. */
  async record(
    entry: SupplierLedgerEntry,
    manager: EntityManager,
  ): Promise<SupplierTransaction> {
    const repo = manager.getRepository(SupplierTransaction);
    return repo.save(
      repo.create({
        supplierId: entry.supplierId,
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

  /** Current payable balance = Σcredit − Σdebit (credit-positive). */
  async balance(supplierId: string): Promise<number> {
    const row = await this.repository
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.debit), 0)', 'd')
      .addSelect('COALESCE(SUM(t.credit), 0)', 'c')
      .where('t.supplierId = :supplierId', { supplierId })
      .getRawOne<{ d: string; c: string }>();
    return round2(Number(row?.c ?? 0) - Number(row?.d ?? 0));
  }

  /** Current payable balances for many suppliers in one query (0 for those with no movements). */
  async balances(supplierIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>(supplierIds.map((id) => [id, 0]));
    if (!supplierIds.length) return map;
    const rows = await this.repository
      .createQueryBuilder('t')
      .select('t.supplierId', 'id')
      .addSelect('COALESCE(SUM(t.credit - t.debit), 0)', 'b')
      .where('t.supplierId IN (:...ids)', { ids: supplierIds })
      .groupBy('t.supplierId')
      .getRawMany<{ id: string; b: string }>();
    for (const r of rows) map.set(r.id, round2(Number(r.b)));
    return map;
  }

  /** Full statement for a supplier, newest first, with the running balance. */
  async statement(supplierId: string): Promise<SupplierStatement> {
    const transactions = await this.repository.find({
      where: { supplierId },
      order: { transactionDate: 'DESC', createdAt: 'DESC' },
    });
    return { balance: await this.balance(supplierId), transactions };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
