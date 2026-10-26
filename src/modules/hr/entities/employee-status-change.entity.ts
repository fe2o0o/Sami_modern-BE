import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Employee } from '../../employee/entities/employee.entity';
import { EmploymentStatus } from '../enums/hr.enum';

/** One status transition of an employee (history is never edited). */
@Entity('employee_status_changes')
export class EmployeeStatusChange extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'enum', enum: EmploymentStatus, nullable: true })
  fromStatus!: EmploymentStatus | null;

  @Column({ type: 'enum', enum: EmploymentStatus })
  toStatus!: EmploymentStatus;

  /** Date the change takes effect (exit date for resigned / terminated). */
  @Column({ type: 'date' })
  effectiveDate!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;
}
