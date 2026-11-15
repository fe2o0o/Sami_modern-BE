import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Employee } from '../../employee/entities/employee.entity';
import { HrRequestStatus, HrRequestType } from '../attendance.enum';

/** An employee → HR request (advance, certificate, punch correction, complaint…) with HR's reply. */
@Entity('hr_requests')
export class HrRequest extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_hr_requests_employee' })
  employee!: Employee;

  @Index('IDX_hr_requests_employee')
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'enum', enum: HrRequestType })
  requestType!: HrRequestType;

  @Column({ type: 'varchar', length: 200 })
  subject!: string;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  /** Advance requests: the amount asked for. */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true, transformer: numericTransformer })
  amount!: number | null;

  @Index('IDX_hr_requests_status')
  @Column({ type: 'enum', enum: HrRequestStatus, default: HrRequestStatus.NEW })
  status!: HrRequestStatus;

  @Column({ type: 'text', nullable: true })
  reply!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  handledByUserId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  handledAt!: Date | null;

  /** Advance requests: the employee advance created when HR approved it (paid later from the advances page). */
  @Index('IDX_hr_requests_advance')
  @Column({ type: 'varchar', length: 36, nullable: true })
  advanceId!: string | null;
}
