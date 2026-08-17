import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { DocumentSequence } from './entities/document-sequence.entity';

/**
 * Concurrency-safe document numbering. Every `next()` runs inside the caller's
 * transaction and locks the sequence row (`SELECT … FOR UPDATE`) before
 * advancing it, so two simultaneous posts can never be assigned the same
 * number. The counter is reusable by any future document type (invoices,
 * vouchers, …) via a distinct `key`.
 */
@Injectable()
export class SequenceService {
  /** Advance the counter for `key` and return the new value. Requires a tx. */
  async next(key: string, manager: EntityManager): Promise<number> {
    const repo = manager.getRepository(DocumentSequence);

    let sequence = await repo.findOne({
      where: { key },
      lock: { mode: 'pessimistic_write' },
    });

    if (!sequence) {
      // First use of this key. Insert (ignore a concurrent insert race) then
      // re-read under the lock so the increment below is serialized.
      await repo
        .createQueryBuilder()
        .insert()
        .values({ key, lastNumber: 0 })
        .orIgnore()
        .execute();
      sequence = await repo.findOne({
        where: { key },
        lock: { mode: 'pessimistic_write' },
      });
    }

    const nextNumber = Number(sequence!.lastNumber) + 1;
    sequence!.lastNumber = nextNumber;
    await repo.save(sequence!);
    return nextNumber;
  }

  /**
   * Journal-entry number scoped per fiscal year, e.g. `JE-2026-000001`. The
   * year segment is taken from the fiscal year's start date so it reads as a
   * calendar year regardless of how the code is formatted.
   */
  async nextJournalNumber(
    fiscalYear: FiscalYear,
    manager: EntityManager,
  ): Promise<string> {
    return this.nextDocumentNumber('JE', fiscalYear, manager);
  }

  /**
   * A document number scoped per fiscal year, e.g. `SI-2026-000001`,
   * `PI-2026-000001`. The counter is keyed by (prefix, fiscal year) so each
   * document type has its own independent, gap-free-per-post sequence.
   */
  async nextDocumentNumber(
    prefix: string,
    fiscalYear: FiscalYear,
    manager: EntityManager,
  ): Promise<string> {
    const year = new Date(fiscalYear.startDate).getFullYear();
    const seq = await this.next(`${prefix}:${fiscalYear.id}`, manager);
    return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
  }
}
