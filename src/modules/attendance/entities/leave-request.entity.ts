import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Employee } from '../../employee/entities/employee.entity';
import { LeaveRequestStatus, RequestSource } from '../attendance.enum';

/** A leave request (from the app or entered by HR). Approved days show as «إجازة» in attendance. */
@Entity('leave_requests')
@Index('IDX_leave_requests_employee_dates', ['employeeId', 'fromDate', 'toDate'])
export class LeaveRequest extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_leave_requests_employee' })
  employee!: Employee;

  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 36 })
  leaveTypeId!: string;

  /** Snapshot, so a renamed type keeps old requests readable. */
  @Column({ type: 'varchar', length: 150 })
  leaveTypeName!: string;

  @Column({ type: 'date' })
  fromDate!: string;

  @Column({ type: 'date' })
  toDate!: string;

  /** Working days only (weekly days off and public holidays are not counted). */
  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0, transformer: numericTransformer })
  days!: number;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Index('IDX_leave_requests_status')
  @Column({ type: 'enum', enum: LeaveRequestStatus, default: LeaveRequestStatus.PENDING })
  status!: LeaveRequestStatus;

  @Column({ type: 'enum', enum: RequestSource, default: RequestSource.APP })
  source!: RequestSource;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  decidedByUserId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  decisionNote!: string | null;
}
