import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/** Product brand / manufacturer. */
@Entity('brands')
export class Brand extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  /** Relative URL/path of the brand logo (upload wired with product images). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logo!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
