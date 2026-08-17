import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Customer } from './customer.entity';
import { CustomerTransactionType } from '../enums/customer-transaction.enum';

/**
 * One movement in a customer's subledger. A debit increases what the customer
 * owes (sales invoice); a credit decreases it (return, receipt, reversal). The
 * running receivable is derived as Σdebit − Σcredit — never stored as a single
 * mutable field. `sourceType`/`sourceId` trace it back to the document.
 */
@Entity('customer_transactions')
@Index(['customerId', 'transactionDate'])
export class CustomerTransaction extends BaseEntity {
  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Index()
  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'date' })
  transactionDate!: string;

  @Column({ type: 'enum', enum: CustomerTransactionType })
  type!: CustomerTransactionType;

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
  createdBy!: string | null;
}
