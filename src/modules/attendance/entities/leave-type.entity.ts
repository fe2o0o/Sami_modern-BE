import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';

/** A kind of leave (سنوية، عارضة، مرضية، بدون أجر…) and its default yearly balance. */
@Entity('leave_types')
export class LeaveType extends BaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  nameEn!: string | null;

  /** Days per year every employee gets unless HR sets their own balance. */
  @Column({ type: 'decimal', precision: 6, scale: 1, default: 0, transformer: numericTransformer })
  defaultDaysPerYear!: number;

  /** false = no balance is tracked (e.g. unpaid leave): any number of days may be requested. */
  @Column({ type: 'boolean', default: true })
  hasBalance!: boolean;

  /** Paid or unpaid — used when attendance is wired to payroll. */
  @Column({ type: 'boolean', default: true })
  isPaid!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}
