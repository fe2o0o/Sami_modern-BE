import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Employee } from '../../employee/entities/employee.entity';
import { PunchSource, PunchStatus, PunchType } from '../attendance.enum';

import { numericTransformer as decimal } from '../../../shared/transformers/numeric.transformer';

/**
 * One check-in / check-out (بصمة). The instant is the SERVER time; `workDate` and
 * `localTime` are its Cairo wall clock (an overnight shift's after-midnight
 * punches belong to the day the shift started).
 */
@Entity('attendance_punches')
@Index('IDX_attendance_punches_employee_date', ['employeeId', 'workDate'])
export class AttendancePunch extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_attendance_punches_employee' })
  employee!: Employee;

  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'enum', enum: PunchType })
  punchType!: PunchType;

  @Column({ type: 'datetime', precision: 3 })
  punchedAt!: Date;

  /** Cairo work date (YYYY-MM-DD). */
  @Index('IDX_attendance_punches_work_date')
  @Column({ type: 'date' })
  workDate!: string;

  /** Cairo wall-clock time "HH:mm:ss". */
  @Column({ type: 'varchar', length: 8 })
  localTime!: string;

  @Column({ type: 'enum', enum: PunchSource, default: PunchSource.MOBILE })
  source!: PunchSource;

  @Index('IDX_attendance_punches_status')
  @Column({ type: 'enum', enum: PunchStatus, default: PunchStatus.ACCEPTED })
  status!: PunchStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectReason!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: decimal })
  latitude!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true, transformer: decimal })
  longitude!: number | null;

  /** GPS accuracy reported by the phone, metres. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: decimal })
  accuracyM!: number | null;

  /** Distance to the matched (or nearest) branch, metres. */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: decimal })
  distanceM!: number | null;

  /** The branch the punch was made at (or the nearest one when rejected). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  branchId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  branchName!: string | null;

  /** The employee's shift at punch time (keeps past days on their old shift). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  shiftId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceInfo!: string | null;

  /** Manual correction: why it was added, and by whom. */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  voidedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  voidReason!: string | null;
}
