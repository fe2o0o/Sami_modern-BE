import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Employee } from '../../employee/entities/employee.entity';
import { PayComponent } from './pay-component.entity';

/**
 * An employee's salary package effective from a date. A raise is a NEW package
 * from a new date; older ones stay as history, so a past month is always paid
 * by the package that was effective then.
 */
@Entity('salary_packages')
@Unique('UQ_salary_packages_employee_from', ['employeeId', 'effectiveFrom'])
export class SalaryPackage extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'date' })
  effectiveFrom!: string;

  /** Totals snapshot (recomputed on save). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalEarnings!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalDeductions!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  netSalary!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;

  @OneToMany(() => SalaryPackageLine, (l) => l.salaryPackage, { cascade: true })
  lines!: SalaryPackageLine[];
}

/** One component of a package: `value` is an amount, or a % of basic for percentage components. */
@Entity('salary_package_lines')
export class SalaryPackageLine extends BaseEntity {
  @ManyToOne(() => SalaryPackage, (p) => p.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'salary_package_id' })
  salaryPackage!: SalaryPackage;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  salaryPackageId!: string;

  @ManyToOne(() => PayComponent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'pay_component_id' })
  payComponent!: PayComponent;

  @Column({ type: 'varchar', length: 36 })
  payComponentId!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  value!: number;

  /** Resolved money amount (= value, or value% × basic). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  amount!: number;
}
