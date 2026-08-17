import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * Unit of measure (piece, meter, kg, …) referenced by products. Kept flat for
 * V1; conversion factors (base unit + ratio) can be added later without a break.
 */
@Entity('units')
export class Unit extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  symbol!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
