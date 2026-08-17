import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import {
  VoucherPaymentMethod,
  VoucherStatus,
  VoucherType,
} from '../enums/voucher.enum';

/**
 * A receipt (from a customer) or payment (to a supplier) voucher. Once POSTED it
 * produces exactly one journal entry, moves the party subledger and moves the
 * treasury/bank subledger — all in one transaction. On-account: it settles the
 * party's overall balance, not specific invoices. A DRAFT has no effect. POSTED
 * and REVERSED are immutable.
 */
@Entity('vouchers')
export class Voucher extends BaseEntity {
  /** Assigned on posting: RV-2026-000001 (receipt) / PV-2026-000001 (payment). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  voucherNumber!: string | null;

  @Index()
  @Column({ type: 'enum', enum: VoucherType })
  type!: VoucherType;

  @Index()
  @Column({ type: 'date' })
  voucherDate!: string;

  /** Customer (RECEIPT) or supplier (PAYMENT) id. */
  @Index()
  @Column({ type: 'uuid' })
  partyId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  partyName!: string | null;

  @Column({ type: 'enum', enum: VoucherPaymentMethod })
  paymentMethod!: VoucherPaymentMethod;

  @Column({ type: 'uuid', nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  bankAccountId!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  /** Cheque/transfer reference, if any. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  reference!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Index()
  @Column({ type: 'enum', enum: VoucherStatus, default: VoucherStatus.DRAFT })
  status!: VoucherStatus;

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

  // ── Audit ──
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
