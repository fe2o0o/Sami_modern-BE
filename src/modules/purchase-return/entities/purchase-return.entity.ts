import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { PurchasePaymentType } from '../../purchase-invoice/enums/purchase-invoice.enum';
import { PurchaseReturnStatus } from '../enums/purchase-return.enum';
import { PurchaseReturnItem } from './purchase-return-item.entity';

/**
 * A purchase return — goods sent back to a supplier against an original purchase
 * invoice. On POSTING, in one transaction: stock is issued out, one journal
 * reduces the payable (or records a refund), reverses the inventory value and the
 * recoverable input VAT, and the supplier's payable is reduced.
 */
@Entity('purchase_returns')
export class PurchaseReturn extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  returnNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  returnDate!: string;

  @Index()
  @Column({ type: 'uuid' })
  purchaseInvoiceId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  supplierId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Column({ type: 'enum', enum: PurchasePaymentType, default: PurchasePaymentType.CREDIT })
  paymentType!: PurchasePaymentType;

  @Column({ type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  subtotal!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  taxableAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  vatAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Index()
  @Column({ type: 'enum', enum: PurchaseReturnStatus, default: PurchaseReturnStatus.DRAFT })
  status!: PurchaseReturnStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @OneToMany(() => PurchaseReturnItem, (item) => item.purchaseReturn, { cascade: true })
  items!: PurchaseReturnItem[];

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
