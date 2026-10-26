import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Employee } from '../../employee/entities/employee.entity';
import { AdvanceStatus, HrCashMethod, HrMovementStatus, InstallmentStatus } from '../enums/advance.enum';

/**
 * Employee advance (سلفة): requested → approved → paid from a treasury/bank
 * (DR employee advances / CR cash) → recovered by monthly installments
 * (manual repayments now, payroll deductions later).
 */
@Entity('employee_advances')
export class EmployeeAdvance extends BaseEntity {
  /** ADV-YYYY-NNNNNN, assigned when paid. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  advanceNumber!: string | null;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employeeName!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  branchId!: string | null;

  @Column({ type: 'date' })
  requestDate!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'int', default: 1 })
  installmentsCount!: number;

  /** First month a deduction is due (stored as the 1st of that month). */
  @Column({ type: 'date' })
  firstDeductionMonth!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Index()
  @Column({ type: 'enum', enum: AdvanceStatus, default: AdvanceStatus.DRAFT })
  status!: AdvanceStatus;

  /** Σ repaid so far (posted repayments). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  repaidAmount!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  approvedAt!: Date | null;

  // ── payment ──
  @Column({ type: 'date', nullable: true })
  paidDate!: string | null;

  @Column({ type: 'enum', enum: HrCashMethod, nullable: true })
  paymentMethod!: HrCashMethod | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bankAccountId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy!: string | null;

  @OneToMany(() => EmployeeAdvanceInstallment, (i) => i.advance, { cascade: true })
  installments!: EmployeeAdvanceInstallment[];

  @OneToMany(() => EmployeeAdvanceRepayment, (r) => r.advance)
  repayments!: EmployeeAdvanceRepayment[];
}

/** One monthly installment of an advance. */
@Entity('employee_advance_installments')
export class EmployeeAdvanceInstallment extends BaseEntity {
  @ManyToOne(() => EmployeeAdvance, (a) => a.installments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'advance_id' })
  advance!: EmployeeAdvance;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  advanceId!: string;

  @Column({ type: 'int' })
  sequence!: number;

  /** Month the installment is due (1st of the month). */
  @Column({ type: 'date' })
  dueMonth!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column({ type: 'enum', enum: InstallmentStatus, default: InstallmentStatus.PENDING })
  status!: InstallmentStatus;
}

/** A cash repayment of an advance (DR cash / CR employee advances). */
@Entity('employee_advance_repayments')
export class EmployeeAdvanceRepayment extends BaseEntity {
  @ManyToOne(() => EmployeeAdvance, (a) => a.repayments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'advance_id' })
  advance!: EmployeeAdvance;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  advanceId!: string;

  @Column({ type: 'date' })
  repaymentDate!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'enum', enum: HrCashMethod })
  method!: HrCashMethod;

  @Column({ type: 'varchar', length: 36, nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bankAccountId!: string | null;

  @Column({ type: 'enum', enum: HrMovementStatus, default: HrMovementStatus.POSTED })
  status!: HrMovementStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Installments this repayment covered: [{ installmentId, amount }] — undone on reversal. */
  @Column({ type: 'json', nullable: true })
  allocation!: { installmentId: string; amount: number }[] | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;
}
