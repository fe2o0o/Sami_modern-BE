import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import {
  SalesInvoiceStatus,
  SalesPaymentType,
} from '../enums/sales-invoice.enum';
import { SalesInvoiceItem } from './sales-invoice-item.entity';
import { SalesInvoiceCommission } from './sales-invoice-commission.entity';

/**
 * A sales invoice — a business document that, once POSTED, issues inventory,
 * moves the customer subledger and produces exactly one journal entry (all in a
 * single transaction). A DRAFT has no financial or stock effect. POSTED and
 * REVERSED invoices are immutable and never physically deleted; corrections are
 * made via a Sales Return or a document Reversal.
 */
@Entity('sales_invoices')
export class SalesInvoice extends BaseEntity {
  /** Assigned on posting (e.g. SI-2026-000001); drafts have none. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  invoiceDate!: string;

  @Index()
  @Column({ type: 'uuid' })
  customerId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Column({ type: 'enum', enum: SalesPaymentType, default: SalesPaymentType.CREDIT })
  paymentType!: SalesPaymentType;

  /** Cash/bank account for a CASH sale (null for CREDIT). */
  @Column({ type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  // ── Totals (server-authoritative) ──
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

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  remainingAmount!: number;

  @Index()
  @Column({ type: 'enum', enum: SalesInvoiceStatus, default: SalesInvoiceStatus.DRAFT })
  status!: SalesInvoiceStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** The journal entry produced on posting. */
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

  /** Total sales commission on the invoice (Σ commission lines). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  commissionTotal!: number;

  @OneToMany(() => SalesInvoiceItem, (item) => item.salesInvoice, {
    cascade: true,
  })
  items!: SalesInvoiceItem[];

  @OneToMany(() => SalesInvoiceCommission, (c) => c.salesInvoice, {
    cascade: true,
  })
  commissions!: SalesInvoiceCommission[];

  // ── Audit ──
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
