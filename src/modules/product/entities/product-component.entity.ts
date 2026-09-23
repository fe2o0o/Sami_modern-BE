import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Product } from './product.entity';

/**
 * One line of a manufactured product's Bill of Materials (BOM): a stock product
 * (raw material / component) consumed to produce ONE unit of the parent product,
 * with the quantity required. This is the permanent recipe stored on the
 * product; a manufacturing order copies it into its own editable component list.
 */
@Entity('product_components')
export class ProductComponent extends BaseEntity {
  @ManyToOne(() => Product, (p) => p.components, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_product_id' })
  parentProduct!: Product;

  @Index()
  @Column({ type: 'uuid' })
  parentProductId!: string;

  /** The stock product consumed as a component. */
  @Index()
  @Column({ type: 'uuid' })
  componentProductId!: string;

  /** Units of the component required to produce ONE unit of the parent. */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;
}
