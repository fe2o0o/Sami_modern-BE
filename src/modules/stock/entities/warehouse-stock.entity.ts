import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Product } from '../../product/entities/product.entity';
import { Warehouse } from '../../warehouse/entities/warehouse.entity';

/**
 * The running on-hand balance of a product in a warehouse. Exactly one row per
 * (warehouse, product); maintained by the stock service as movements are
 * applied. `avgCost` is the weighted-average unit cost of the on-hand quantity.
 */
@Entity('warehouse_stock')
@Index(['warehouseId', 'productId'], { unique: true })
export class WarehouseStock extends BaseEntity {
  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  /**
   * Soft hold: quantity committed to posted sales invoices but not yet delivered.
   * Available-to-promise = `quantity − reservedQuantity`. A reservation is not a
   * physical movement (no StockMovement row) — it only affects availability.
   */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  reservedQuantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  avgCost!: number;
}
