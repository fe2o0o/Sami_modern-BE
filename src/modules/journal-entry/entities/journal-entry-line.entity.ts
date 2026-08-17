import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { JournalEntry } from './journal-entry.entity';

/**
 * One line of a {@link JournalEntry}. Each line hits a single posting account
 * on exactly one side — either debit or credit, never both.
 *
 * The optional analytical references (customer/supplier/warehouse/product) let
 * subledgers and future reports slice ledger activity without a separate table.
 * Extra dimensions (cost center, project, employee) can be added later without
 * changing the posting engine.
 */
@Entity('journal_entry_lines')
export class JournalEntryLine extends BaseEntity {
  @ManyToOne(() => JournalEntry, (entry) => entry.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry!: JournalEntry;

  @Column({ type: 'uuid' })
  journalEntryId!: string;

  @Index()
  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  debit!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  credit!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  // =========================
  // ANALYTICAL DIMENSIONS (optional subledger references)
  // =========================
  /**
   * Branch this line belongs to (line-level, so one journal entry can span
   * branches — e.g. an opening balance with treasuries in several branches).
   * GL / Trial Balance filter by this; falls back to the entry's branch.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  productId!: string | null;
}
