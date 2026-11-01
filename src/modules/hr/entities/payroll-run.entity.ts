import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import {
  PayrollAdvanceAllocation,
  PayrollCommissionDetail,
  PayrollLineAdjustment,
  PayrollLineComponent,
  PayrollStatus,
} from '../enums/payroll.enum';
import { HrCashMethod, HrMovementStatus } from '../enums/advance.enum';

/**
 * Monthly payroll run (مسير الرواتب) of ONE branch: a line per employee paid by
 * that branch. Draft → approved (posted by finance) → paid (treasury / bank) —
 * reversible before any payment.
 */
@Entity('payroll_runs')
export class PayrollRun extends BaseEntity {
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  runNumber!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  branchId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branchName!: string | null;

  /** First day of the paid month. */
  @Column({ type: 'date' })
  periodMonth!: string;

  @Column({ type: 'enum', enum: PayrollStatus, default: PayrollStatus.DRAFT })
  status!: PayrollStatus;

  /** Basic + allowances (pay-component earnings). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalEarnings!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalCommissions!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalBonuses!: number;

  /** Pay-component deductions (taxes, insurance…) + penalties. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalDeductions!: number;

  /** Advance installments recovered. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalAdvances!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalNet!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: 'int', default: 0 })
  employeesCount!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy!: string | null;

  @OneToMany(() => PayrollLine, (l) => l.run, { cascade: true })
  lines!: PayrollLine[];

  @OneToMany(() => PayrollPayment, (p) => p.run)
  payments!: PayrollPayment[];
}

/** One employee on a payroll run. net = earnings + commissions + bonuses − deductions − advances. */
@Entity('payroll_lines')
export class PayrollLine extends BaseEntity {
  @ManyToOne(() => PayrollRun, (r) => r.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: PayrollRun;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  runId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  employeeCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employeeName!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  jobTitle!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  departmentName!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  salaryPackageId!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  basicSalary!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  earnings!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  commissions!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  bonuses!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  deductions!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  advances!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  netPay!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: 'json', nullable: true })
  components!: PayrollLineComponent[] | null;

  @Column({ type: 'json', nullable: true })
  adjustments!: PayrollLineAdjustment[] | null;

  @Column({ type: 'json', nullable: true })
  advanceAllocation!: PayrollAdvanceAllocation[] | null;

  @Column({ type: 'json', nullable: true })
  commissionDetail!: PayrollCommissionDetail | null;

  /** Bank details snapshot (bank-transfer file). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  bankAccountNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  iban!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}

/** Salaries paid out of a run (some or all lines) from a treasury or bank. */
@Entity('payroll_payments')
export class PayrollPayment extends BaseEntity {
  @ManyToOne(() => PayrollRun, (r) => r.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run!: PayrollRun;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  runId!: string;

  @Column({ type: 'date' })
  paymentDate!: string;

  @Column({ type: 'enum', enum: HrCashMethod })
  method!: HrCashMethod;

  @Column({ type: 'varchar', length: 36, nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bankAccountId!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  /** Lines paid and how much each. */
  @Column({ type: 'json' })
  lines!: { lineId: string; employeeId: string; amount: number }[];

  @Column({ type: 'enum', enum: HrMovementStatus, default: HrMovementStatus.POSTED })
  status!: HrMovementStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;
}
