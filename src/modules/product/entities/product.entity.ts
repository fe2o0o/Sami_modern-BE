import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { ProductType } from '../enums/product-type.enum';
import { ProductCategory } from '../../product-category/entities/product-category.entity';
import { Brand } from '../../brand/entities/brand.entity';
import { Unit } from '../../unit/entities/unit.entity';
import { ProductImage } from './product-image.entity';
import { ProductComponent } from './product-component.entity';

/**
 * Central product master used by inventory, purchasing, sales and
 * manufacturing. Accounting columns are optional overrides — when null, posting
 * falls back to the company Accounting Settings, so data is never duplicated.
 */
@Entity('products')
export class Product extends BaseEntity {
  // ── Basic ──
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // ── Classification ──
  @ManyToOne(() => ProductCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category!: ProductCategory | null;

  @Column({ type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Brand, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'brand_id' })
  brand!: Brand | null;

  @Column({ type: 'uuid', nullable: true })
  brandId!: string | null;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit | null;

  @Column({ type: 'uuid', nullable: true })
  unitId!: string | null;

  // ── Type ──
  @Column({
    type: 'enum',
    enum: ProductType,
    default: ProductType.FINISHED_PRODUCT,
  })
  productType!: ProductType;

  // ── Inventory ──
  @Column({ type: 'boolean', default: true })
  trackInventory!: boolean;

  /**
   * When true this product is produced in-house: it has a bill of materials and
   * a sales invoice for it auto-creates a draft manufacturing order on posting.
   */
  @Column({ type: 'boolean', default: false })
  isManufactured!: boolean;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  minQuantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  maxQuantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  reorderPoint!: number;

  // ── Pricing ──
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  costPrice!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  sellingPrice!: number;

  // ── Accounting overrides (fall back to Accounting Settings when null) ──
  @Column({ type: 'uuid', nullable: true })
  inventoryAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cogsAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  salesAccountId!: string | null;

  // ── Status ──
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // ── Images ──
  @OneToMany(() => ProductImage, (image) => image.product, { cascade: true })
  images!: ProductImage[];

  // ── Bill of Materials (for manufactured products) ──
  @OneToMany(() => ProductComponent, (c) => c.parentProduct, { cascade: true })
  components!: ProductComponent[];
}
