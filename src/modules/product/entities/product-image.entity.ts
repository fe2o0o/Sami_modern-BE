import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Product } from './product.entity';

/**
 * One image belonging to a product. Files live on disk under
 * `uploads/products/`; this row stores only metadata + the public URL. Exactly
 * one image per product should be `isPrimary`.
 */
@Entity('product_images')
export class ProductImage extends BaseEntity {
  @ManyToOne(() => Product, (product) => product.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ type: 'varchar', length: 255 })
  originalName!: string;

  @Column({ type: 'int', default: 0 })
  fileSize!: number;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  /** Public URL relative to the server root, e.g. /uploads/products/<file>. */
  @Column({ type: 'varchar', length: 500 })
  url!: string;

  @Column({ type: 'int', default: 0 })
  displayOrder!: number;

  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;
}
