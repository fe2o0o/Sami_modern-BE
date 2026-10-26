import { Column, Entity, Index, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Branch } from '../../branch/entities/branch.entity';
import { Department } from '../../hr/entities/department.entity';
import { JobGrade } from '../../hr/entities/job-grade.entity';
import { ContractType, EmploymentStatus, Gender, MaritalStatus } from '../../hr/enums/hr.enum';

/** Employee master — basic data, HR profile (department, contract, status…), net salary and a default sales-commission rate. */
@Entity('employees')
export class Employee extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  nationalId!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  jobTitle!: string | null;

  /** Branches this employee serves. EMPTY = available to all branches. */
  @ManyToMany(() => Branch)
  @JoinTable({
    name: 'employee_branches',
    joinColumn: { name: 'employee_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'branch_id', referencedColumnName: 'id' },
  })
  branches!: Branch[];

  @Column({ type: 'date', nullable: true })
  hireDate!: string | null;

  /** Net monthly salary. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  netSalary!: number;

  /** Default sales-commission percentage (e.g. 2.5 = 2.5%) pre-filled on invoices. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0, transformer: numericTransformer })
  commissionRate!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** Kept in sync with `employmentStatus`: false once resigned / terminated. */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // ── HR profile (all optional) ───────────────────────────
  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department!: Department | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  departmentId!: string | null;

  @ManyToOne(() => JobGrade, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'job_grade_id' })
  jobGrade!: JobGrade | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  jobGradeId!: string | null;

  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'direct_manager_id' })
  directManager!: Employee | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  directManagerId!: string | null;

  @Column({ type: 'enum', enum: ContractType, nullable: true })
  contractType!: ContractType | null;

  @Column({ type: 'date', nullable: true })
  contractStart!: string | null;

  @Column({ type: 'date', nullable: true })
  contractEnd!: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender!: Gender | null;

  @Column({ type: 'enum', enum: MaritalStatus, nullable: true })
  maritalStatus!: MaritalStatus | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  qualification!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  socialInsuranceNumber!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  bankAccountNumber!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  iban!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emergencyContactName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  emergencyContactRelation!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  emergencyContactMobile!: string | null;

  @Column({ type: 'enum', enum: EmploymentStatus, default: EmploymentStatus.ACTIVE })
  employmentStatus!: EmploymentStatus;

  /** Last working day for resigned / terminated employees. */
  @Column({ type: 'date', nullable: true })
  exitDate!: string | null;

  @Column({ type: 'text', nullable: true })
  exitReason!: string | null;

  /** Linked system user (one user ↔ at most one employee). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 36, nullable: true })
  userId!: string | null;

  /** Stored photo file name (private storage, served through an authenticated endpoint). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  photoName!: string | null;
}
