import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * Product category supporting unlimited hierarchy via a self-referencing
 * parent. `level` (root = 1) is maintained by the service for easy tree display.
 */
@Entity('product_categories')
export class ProductCategory extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // =========================
  // ACCOUNTING (optional): every product in this category (and its
  // sub-categories, unless they set their own) posts to these accounts.
  // Empty -> the defaults from Accounting Settings.
  // =========================
  @Column({ type: 'uuid', nullable: true })
  inventoryAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cogsAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  salesAccountId!: string | null;

  // =========================
  // HIERARCHY
  // =========================
  @ManyToOne(() => ProductCategory, (category) => category.children, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'parent_id' })
  parent!: ProductCategory | null;

  @Column({ type: 'uuid', nullable: true })
  parentId!: string | null;

  @OneToMany(() => ProductCategory, (category) => category.parent)
  children!: ProductCategory[];
}
