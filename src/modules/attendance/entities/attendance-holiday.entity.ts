import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/** A public holiday (إجازة رسمية) — for every branch, or one branch only. */
@Entity('attendance_holidays')
export class AttendanceHoliday extends BaseEntity {
  @Index('IDX_attendance_holidays_date')
  @Column({ type: 'date' })
  holidayDate!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  /** null = all branches. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  branchId!: string | null;
}
