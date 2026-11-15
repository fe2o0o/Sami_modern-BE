import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';

/** HR's own yearly entitlement for one employee + leave type (overrides the type's default). */
@Entity('employee_leave_balances')
@Index('UQ_employee_leave_balances', ['employeeId', 'leaveTypeId', 'year'], { unique: true })
export class EmployeeLeaveBalance extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 36 })
  leaveTypeId!: string;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0, transformer: numericTransformer })
  entitledDays!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
