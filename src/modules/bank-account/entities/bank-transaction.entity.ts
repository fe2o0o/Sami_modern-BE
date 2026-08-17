import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { BankAccount } from './bank-account.entity';
import { BankTransactionType } from '../enums/bank-transaction.enum';

/**
 * One movement in a bank account's subledger. Balance = Σdebit − Σcredit (debit
 * = money in). The General Ledger still reads JournalEntryLine, never this table.
 */
@Entity('bank_transactions')
@Index(['bankAccountId', 'transactionDate'])
export class BankTransaction extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  bankAccountId!: string;

  @ManyToOne(() => BankAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount!: BankAccount;

  @Column({ type: 'date' })
  transactionDate!: string;

  @Column({ type: 'enum', enum: BankTransactionType })
  type!: BankTransactionType;

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
