import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Employee } from '../../employee/entities/employee.entity';
import { LeaveRequestStatus, PermissionType, RequestSource } from '../attendance.enum';

/**
 * «إذن» — a part of one work day away from the branch:
 *  - mission (مأمورية): work outside; its time counts as work (a full-day mission = present);
 *  - personal (شخصي): excuses lateness / early leave inside its time, from a monthly hours cap.
 * Only APPROVED permissions change the attendance calculation.
 */
@Entity('attendance_permissions')
@Index('IDX_attendance_permissions_employee_date', ['employeeId', 'permissionDate'])
export class AttendancePermission extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id', foreignKeyConstraintName: 'FK_attendance_permissions_employee' })
  employee!: Employee;

  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'enum', enum: PermissionType })
  permissionType!: PermissionType;

  /** The work date (Cairo). */
  @Column({ type: 'date' })
  permissionDate!: string;

  /** Missions only: the whole shift. */
  @Column({ type: 'boolean', default: false })
  fullDay!: boolean;

  /** "HH:mm" (null for a full-day mission). */
  @Column({ type: 'varchar', length: 5, nullable: true })
  fromTime!: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  toTime!: string | null;

  /** Length in minutes (a full-day mission = the shift length). */
  @Column({ type: 'int', default: 0 })
  minutes!: number;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Index('IDX_attendance_permissions_status')
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
