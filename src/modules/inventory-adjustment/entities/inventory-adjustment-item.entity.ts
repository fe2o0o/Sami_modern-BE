import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { AdjustmentType } from '../enums/inventory-adjustment.enum';
import { InventoryAdjustment } from './inventory-adjustment.entity';

/**
 * One line of a stock adjustment. For an INCREASE the `unitCost` is entered (the
 * cost the added quantity enters at); for a DECREASE it is captured from the
 * product's current weighted-average cost at posting. `lineValue` = quantity ×
 * unitCost.
 */
@Entity('inventory_adjustment_items')
export class InventoryAdjustmentItem extends BaseEntity {
  @ManyToOne(() => InventoryAdjustment, (a) => a.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inventory_adjustment_id' })
  adjustment!: InventoryAdjustment;

  @Column({ type: 'uuid' })
  inventoryAdjustmentId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  productCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

  @Column({ type: 'enum', enum: AdjustmentType })
  adjustmentType!: AdjustmentType;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCost!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  lineValue!: number;
}
