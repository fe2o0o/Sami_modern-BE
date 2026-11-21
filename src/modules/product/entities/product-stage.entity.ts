import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Product } from './product.entity';

/**
 * One step of a manufactured product's production route: the stages it goes
 * through, in order (like its BOM). An internal manufacturing order copies them
 * into its own trackable list.
 */
@Entity('product_stages')
export class ProductStage extends BaseEntity {
  @ManyToOne(() => Product, (p) => p.stages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Index()
  @Column({ type: 'uuid' })
  productId!: string;

  /** The stage (manufacturing_stages). */
  @Column({ type: 'uuid' })
  stageId!: string;

  /** 1-based position on the route. */
  @Column({ type: 'int', default: 1 })
  sequence!: number;

  /** Expected working days for this stage on this product (late flag). */
  @Column({ type: 'int', nullable: true })
  expectedDays!: number | null;
}
