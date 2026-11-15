import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';

/** Company-wide attendance settings (a single row). */
@Entity('attendance_settings')
export class AttendanceSetting extends BaseEntity {
  /** Personal permissions (إذن شخصي) allowed per employee per month, in hours. null = no cap. */
  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, default: 4, transformer: numericTransformer })
  personalPermissionHoursPerMonth!: number | null;
}
