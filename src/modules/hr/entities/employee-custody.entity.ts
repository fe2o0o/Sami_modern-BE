import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Employee } from '../../employee/entities/employee.entity';
import { CustodySettlementType, CustodyStatus, HrCashMethod, HrMovementStatus } from '../enums/advance.enum';

/**
 * Employee custody (عهدة): cash handed to an employee for work purposes
 * (DR employee custody / CR cash), later settled by returned cash and/or
 * expense receipts.
 */
@Entity('employee_custodies')
export class EmployeeCustody extends BaseEntity {
  /** CUS-YYYY-NNNNNN, assigned when posted. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  custodyNumber!: string | null;

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
  custodyDate!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  purpose!: string | null;

  @Index()
  @Column({ type: 'enum', enum: CustodyStatus, default: CustodyStatus.DRAFT })
  status!: CustodyStatus;

  /** Σ settled (posted settlements: returned cash + expenses). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  settledAmount!: number;

  @Column({ type: 'enum', enum: HrCashMethod })
  paymentMethod!: HrCashMethod;

  @Column({ type: 'varchar', length: 36, nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bankAccountId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reversalJournalEntryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updatedBy!: string | null;

  @OneToMany(() => EmployeeCustodySettlement, (s) => s.custody)
  settlements!: EmployeeCustodySettlement[];
}

/** A settlement of a custody: cash returned, or expenses (with lines). */
@Entity('employee_custody_settlements')
export class EmployeeCustodySettlement extends BaseEntity {
  @ManyToOne(() => EmployeeCustody, (c) => c.settlements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'custody_id' })
  custody!: EmployeeCustody;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  custodyId!: string;

  @Column({ type: 'date' })
  settlementDate!: string;

  @Column({ type: 'enum', enum: CustodySettlementType })
  settlementType!: CustodySettlementType;

  @Column({ type: 'decimal', precision: 18, scale: 2, transformer: numericTransformer })
  amount!: number;

  /** Cash return only. */
  @Column({ type: 'enum', enum: HrCashMethod, nullable: true })
  method!: HrCashMethod | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  bankAccountId!: string | null;

  /** Expenses only: [{ accountId, amount, description }]. */
  @Column({ type: 'json', nullable: true })
  expenseLines!: { accountId: string; amount: number; description: string | null }[] | null;

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
