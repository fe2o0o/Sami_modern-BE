import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { OpeningBalanceStatus } from '../enums/opening-balance.enum';
import { OpeningBalanceDetail } from './opening-balance-detail.entity';

/**
 * The company's initial financial position for a fiscal year, captured before
 * day-to-day operations begin. Once posted it is read-only and linked to the
 * journal entry it generated; a posted balance can only be REVERSED (never
 * edited), and corrections are made through a new copied DRAFT.
 *
 * Uniqueness ("one active balance per fiscal year") is enforced in the service,
 * NOT by a DB unique index — REVERSED historical rows must be allowed to
 * coexist with the new active balance, which a plain unique index can't express.
 */
@Entity('opening_balances')
export class OpeningBalance extends BaseEntity {
  @Column({ type: 'uuid' })
  companyId!: string;

  @Index()
  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Column({ type: 'date' })
  openingDate!: string;

  @Column({
    type: 'enum',
    enum: OpeningBalanceStatus,
    default: OpeningBalanceStatus.DRAFT,
  })
  status!: OpeningBalanceStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** When true, an opening-balance-equity line is auto-generated to balance. */
  @Column({ type: 'boolean', default: true })
  autoBalance!: boolean;

  @Column({ type: 'boolean', default: false })
  posted!: boolean;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  /** The journal entry produced on posting. */
  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  // =========================
  // REVERSAL (set when status → REVERSED)
  // =========================
  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'date', nullable: true })
  reversalDate!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalPeriodId!: string | null;

  /** The opposite journal entry created by the reversal. */
  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  /** When this balance was created as a correction copy of a reversed one. */
  @Column({ type: 'uuid', nullable: true })
  copiedFromOpeningBalanceId!: string | null;

  @OneToMany(() => OpeningBalanceDetail, (detail) => detail.openingBalance, {
    cascade: true,
  })
  details!: OpeningBalanceDetail[];

  // Audit
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
