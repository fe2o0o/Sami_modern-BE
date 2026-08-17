import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import {
  JournalEntryStatus,
  JournalSourceType,
} from '../enums/journal-entry.enum';
import { JournalEntryLine } from './journal-entry-line.entity';

/**
 * A double-entry posting — the single source of truth for the general ledger.
 * Every financial document that affects the ledger (manual entries, opening
 * balances now; sales, purchases, vouchers later) produces exactly one
 * JournalEntry with two or more lines whose total debit equals total credit.
 *
 * `sourceType`/`sourceId`/`sourceNumber` trace the entry back to the document
 * that created it. A POSTED or REVERSED entry is immutable and must never be
 * deleted; corrections are made by posting a reversal + a new entry.
 */
@Entity('journal_entries')
export class JournalEntry extends BaseEntity {
  /**
   * The accounting document number, e.g. `JE-2026-000001`. Assigned only when
   * the entry is posted — drafts have none — so posted numbers stay gap-free.
   * Unique across all entries (MySQL permits multiple NULLs in a unique index).
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  entryNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  entryDate!: string;

  @Index()
  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Originating document type — {@link JournalSourceType}. */
  @Index()
  @Column({ type: 'varchar', length: 50, default: JournalSourceType.MANUAL })
  sourceType!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  /** Human-readable number of the source document (for search/display). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceNumber!: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: JournalEntryStatus,
    default: JournalEntryStatus.DRAFT,
  })
  status!: JournalEntryStatus;

  /**
   * True once the entry affects the ledger. Stays true after reversal (the
   * original + its reversal net to zero), so ledger/trial-balance reads filter
   * on `isPosted = true` while `status` carries the lifecycle.
   */
  @Column({ type: 'boolean', default: false })
  isPosted!: boolean;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalDebit!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalCredit!: number;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  // =========================
  // REVERSAL (bidirectional link)
  // =========================
  /** On a reversal entry: the original entry it reverses. */
  @Column({ type: 'uuid', nullable: true })
  reversalOfJournalEntryId!: string | null;

  /** On the original entry: the reversal entry created against it. */
  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @OneToMany(() => JournalEntryLine, (line) => line.journalEntry, {
    cascade: true,
  })
  lines!: JournalEntryLine[];

  // Audit
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
