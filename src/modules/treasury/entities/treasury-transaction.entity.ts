import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Treasury } from './treasury.entity';
import { TreasuryTransactionType } from '../enums/treasury-transaction.enum';

/**
 * One movement in a treasury's subledger. The treasury balance = Σdebit −
 * Σcredit over these rows (debit = cash in). `sourceType`/`sourceId` trace it to
 * the originating document; `journalEntryId` links to the GL entry it posted
 * with. This is the operational cash ledger — the General Ledger still reads
 * JournalEntryLine, never this table.
 */
@Entity('treasury_transactions')
@Index(['treasuryId', 'transactionDate'])
export class TreasuryTransaction extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  treasuryId!: string;

  @ManyToOne(() => Treasury, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'treasury_id' })
  treasury!: Treasury;

  @Column({ type: 'date' })
  transactionDate!: string;

  @Column({ type: 'enum', enum: TreasuryTransactionType })
  type!: TreasuryTransactionType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceNumber!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  debit!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  credit!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;
}
