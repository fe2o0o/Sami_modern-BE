import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * A production stage of the in-house workshop (تقطيع، نجارة، تنجيد، دهان …) —
 * defined once, then picked in order on each manufactured product (its route)
 * and tracked on every internal manufacturing order.
 */
@Entity('manufacturing_stages')
export class ManufacturingStage extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nameEn!: string | null;

  /** Default position when picking stages (lower first). */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  /** Typical working days — the default «expected days» on a product's route. */
  @Column({ type: 'int', nullable: true })
  defaultDays!: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
