import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AccountingPeriod } from '../entities/accounting-period.entity';
import { FiscalYear } from '../../fiscal-year/entities/fiscal-year.entity';

/** Arabic month names used to label generated periods. */
const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export interface PeriodDraft {
  name: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
}

/**
 * Single-responsibility service: turns a fiscal year date range into monthly
 * accounting periods. Kept isolated from FiscalYearService so it can be reused
 * (setup wizard, manual generation, future re-generation tooling) and tested
 * on its own.
 */
@Injectable()
export class AccountingPeriodGeneratorService {
  /**
   * Pure calculation — one period per calendar month the range touches, with
   * the first/last period clipped to the fiscal year boundaries. Works for any
   * start month (e.g. 01/04/2026 → 31/03/2027).
   */
  buildPeriods(startDate: string, endDate: string): PeriodDraft[] {
    const start = this.parse(startDate);
    const end = this.parse(endDate);
    const drafts: PeriodDraft[] = [];

    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    let periodNumber = 1;

    while (cursor <= end) {
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      // Day 0 of the next month === last day of this month.
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

      drafts.push({
        periodNumber,
        name: `${AR_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`,
        startDate: this.toIso(monthStart < start ? start : monthStart),
        endDate: this.toIso(monthEnd > end ? end : monthEnd),
      });

      periodNumber += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return drafts;
  }

  /**
   * Persist the generated periods for a fiscal year using the caller's
   * EntityManager, so it participates in an outer transaction.
   */
  async generateForFiscalYear(
    fiscalYear: FiscalYear,
    manager: EntityManager,
    actorId?: string | null,
  ): Promise<AccountingPeriod[]> {
    const repo = manager.getRepository(AccountingPeriod);
    const drafts = this.buildPeriods(fiscalYear.startDate, fiscalYear.endDate);

    const entities = drafts.map((draft) =>
      repo.create({
        ...draft,
        fiscalYearId: fiscalYear.id,
        isClosed: false,
        createdBy: actorId ?? null,
      }),
    );

    return repo.save(entities);
  }

  private parse(value: string): Date {
    // Force local midnight so month math is timezone-safe.
    const [y, m, d] = value.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private toIso(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
