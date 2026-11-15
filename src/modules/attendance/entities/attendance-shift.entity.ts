import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/** A work shift (الوردية): its hours, grace periods and weekly days off — Cairo wall-clock times. */
@Entity('attendance_shifts')
export class AttendanceShift extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  /** "HH:mm" */
  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  /** "HH:mm" — earlier than `startTime` = the shift ends the next day. */
  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

  /** Arriving within these minutes is not late. */
  @Column({ type: 'int', default: 15 })
  lateGraceMinutes!: number;

  /** Leaving within these minutes before the end is not early. */
  @Column({ type: 'int', default: 0 })
  earlyLeaveGraceMinutes!: number;

  /** Staying after the end counts as overtime only from this many minutes. */
  @Column({ type: 'int', default: 30 })
  overtimeAfterMinutes!: number;

  /** Weekly days off, 0 = Sunday … 6 = Saturday (e.g. [5] = Friday). */
  @Column({ type: 'simple-json' })
  weeklyOffDays!: number[];

  /** Used for employees with no shift of their own (one default at most). */
  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
