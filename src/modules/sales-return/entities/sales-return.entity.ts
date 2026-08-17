import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesPaymentType } from '../../sales-invoice/enums/sales-invoice.enum';
import { SalesReturnStatus } from '../enums/sales-return.enum';
import { SalesReturnItem } from './sales-return-item.entity';

/**
 * A sales return — goods a customer sends back against an original sales
 * invoice. On POSTING, in one transaction: stock (for stock lines) is received
 * back at its original cost, one journal reverses the sale proportionally
 * (revenue/VAT down, COGS reversed, inventory up), and the customer's receivable
 * is reduced (credit sale) or a cash/bank refund is paid (cash sale).
 */
@Entity('sales_returns')
export class SalesReturn extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  returnNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  returnDate!: string;

  /** The original sales invoice this return is against. */
  @Index()
  @Column({ type: 'uuid' })
  salesInvoiceId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Column({ type: 'enum', enum: SalesPaymentType, default: SalesPaymentType.CREDIT })
  paymentType!: SalesPaymentType;

  /** Cash/bank account refunded for a CASH-sale return. */
  @Column({ type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  // ── Totals (of the returned amounts) ──
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
  @Column({ type: 'enum', enum: SalesReturnStatus, default: SalesReturnStatus.DRAFT })
  status!: SalesReturnStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  // ── Reversal ──
  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @OneToMany(() => SalesReturnItem, (item) => item.salesReturn, { cascade: true })
  items!: SalesReturnItem[];

  // ── Audit ──
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
