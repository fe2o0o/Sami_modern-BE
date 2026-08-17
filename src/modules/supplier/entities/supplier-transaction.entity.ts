import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Supplier } from './supplier.entity';
import { SupplierTransactionType } from '../enums/supplier-transaction.enum';

/**
 * One movement in a supplier's subledger. A credit increases what we owe the
 * supplier (purchase invoice, opening balance); a debit decreases it (payment,
 * purchase return, reversal). The running payable is derived as Σcredit − Σdebit
 * (credit-normal) — never stored as a single mutable field. `sourceType`/
 * `sourceId` trace it back to the document.
 */
@Entity('supplier_transactions')
@Index(['supplierId', 'transactionDate'])
export class SupplierTransaction extends BaseEntity {
  @ManyToOne(() => Supplier, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplier_id' })
  supplier!: Supplier;

  @Index()
  @Column({ type: 'uuid' })
  supplierId!: string;

  @Column({ type: 'date' })
  transactionDate!: string;

  @Column({ type: 'enum', enum: SupplierTransactionType })
  type!: SupplierTransactionType;

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
