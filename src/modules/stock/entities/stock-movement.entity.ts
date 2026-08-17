import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { Product } from '../../product/entities/product.entity';
import { Warehouse } from '../../warehouse/entities/warehouse.entity';
import { StockDirection, StockMovementType } from '../enums/stock.enum';

/**
 * Immutable audit trail of every stock change. Balances (WarehouseStock) are
 * derived from these. `sourceType`/`sourceId` trace a movement back to the
 * document that caused it (e.g. 'opening_balance').
 */
@Entity('stock_movements')
export class StockMovement extends BaseEntity {
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

  @Column({ type: 'enum', enum: StockDirection })
  direction!: StockDirection;

  @Column({ type: 'enum', enum: StockMovementType })
  movementType!: StockMovementType;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCost!: number;

  @Column({ type: 'date' })
  movementDate!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  /** Human-readable number of the source document (e.g. SI-2026-000001). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceNumber!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;
}
