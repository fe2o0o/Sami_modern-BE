import { EntityManager, In } from 'typeorm';
import { JournalEntry } from '../../modules/journal-entry/entities/journal-entry.entity';

/**
 * Statements: tell an entry and the reversal that cancels it apart from the rest,
 * so a statement can hide both («بدون القيود المعكوسة») and still show the right
 * balance — a matched pair always nets to zero.
 *
 * A reversal is matched to the OLDEST unmatched non-reversal row with the same
 * key and exactly opposite amounts. Anything that doesn't match exactly (a partial
 * reversal, or the other half outside the statement's date range) stays unpaired
 * and visible. Rows keep their order; the pair id is shared by both halves.
 */
export function markReversalPairs<T extends { debit: number | string; credit: number | string }>(
  rows: T[],
  keyOf: (row: T) => string | null,
  isReversal: (row: T) => boolean,
): (T & { reversalPairId: string | null })[] {
  const out = rows.map((r) => Object.assign(r, { reversalPairId: null as string | null }));
  const r2 = (v: number | string) => Math.round((Number(v) || 0) * 100);
  const byKey = new Map<string, (T & { reversalPairId: string | null })[]>();
  for (const row of out) {
    if (isReversal(row)) continue;
    const k = keyOf(row);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(row);
    byKey.set(k, list);
  }
  let n = 0;
  for (const rev of out) {
    if (!isReversal(rev)) continue;
    const k = keyOf(rev);
    if (!k) continue;
    const match = (byKey.get(k) ?? []).find((o) => !o.reversalPairId && r2(o.debit) === r2(rev.credit) && r2(o.credit) === r2(rev.debit));
    if (match) match.reversalPairId = rev.reversalPairId = `p${++n}`;
  }
  return out;
}

/** reversal journal entry id → the entry it reverses, for the given entry ids. */
export async function reversalOrigins(manager: EntityManager, entryIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(entryIds.filter((v): v is string => !!v))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const entries = await manager
    .getRepository(JournalEntry)
    .find({ where: { id: In(ids) }, select: { id: true, reversalOfJournalEntryId: true }, withDeleted: true });
  for (const e of entries) if (e.reversalOfJournalEntryId) map.set(e.id, e.reversalOfJournalEntryId);
  return map;
}

/**
 * Pairs for a party ledger (customer / supplier): a document's reversal is written
 * on the same source; a manual journal reversal is its own entry, so it is mapped
 * back to the original entry first.
 */
export async function pairPartyLedger<T extends { type: string; sourceType: string | null; sourceId: string | null; debit: number; credit: number }>(
  manager: EntityManager,
  rows: T[],
): Promise<(T & { reversalPairId: string | null })[]> {
  const isRev = (r: T) => r.type === 'reversal';
  const origin = await reversalOrigins(manager, rows.filter((r) => isRev(r) && r.sourceType === 'journal_entry').map((r) => r.sourceId));
  return markReversalPairs(
    rows,
    (r) => (r.sourceId ? `${r.sourceType ?? ''}:${(isRev(r) && origin.get(r.sourceId)) || r.sourceId}` : null),
    isRev,
  );
}

/**
 * Pairs for a cash ledger (treasury / bank): rows carry the journal entry they
 * posted with, and a reversal row's entry points back to the original's — exact
 * even when one source has many movements (e.g. an advance's repayments).
 * Rows without an entry fall back to the source.
 */
export async function pairCashLedger<
  T extends { type: string; sourceType: string | null; sourceId: string | null; journalEntryId: string | null; debit: number; credit: number },
>(manager: EntityManager, rows: T[]): Promise<(T & { reversalPairId: string | null })[]> {
  const isRev = (r: T) => r.type === 'reversal';
  const origin = await reversalOrigins(manager, rows.filter(isRev).map((r) => r.journalEntryId));
  return markReversalPairs(
    rows,
    (r) => {
      if (r.journalEntryId) return `je:${(isRev(r) && origin.get(r.journalEntryId)) || r.journalEntryId}`;
      return r.sourceId ? `src:${r.sourceType ?? ''}:${r.sourceId}` : null;
    },
    isRev,
  );
}

/**
 * Pairs for journal-line statements (employee statement, general ledger): a line
 * of a reversal entry matches the same account's line of the entry it reverses.
 */
export function pairJournalLines<T extends { journalEntryId: string; reversalOfJournalEntryId: string | null; accountId: string; debit: number; credit: number }>(
  rows: T[],
): (T & { reversalPairId: string | null })[] {
  return markReversalPairs(
    rows,
    (r) => `${r.accountId}:${r.reversalOfJournalEntryId ?? r.journalEntryId}`,
    (r) => !!r.reversalOfJournalEntryId,
  );
}
