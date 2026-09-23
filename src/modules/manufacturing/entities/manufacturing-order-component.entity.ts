import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { ManufacturingOrder } from './manufacturing-order.entity';

/**
 * One component (raw material) line of a manufacturing order — copied from the
 * product's Bill of Materials when the order is created, then editable per
 * order. `quantity` is the TOTAL required for the whole order (BOM per-unit ×
 * order quantity). `unitCost`/`lineCost` are filled at production time from the
 * weighted-average cost the component is issued out of stock at.
 */
@Entity('manufacturing_order_components')
export class ManufacturingOrderComponent extends BaseEntity {
  @ManyToOne(() => ManufacturingOrder, (o) => o.components, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'manufacturing_order_id' })
  manufacturingOrder!: ManufacturingOrder;

  @Column({ type: 'uuid' })
  manufacturingOrderId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  componentProductId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  componentProductName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

  /** Total quantity consumed for the whole order. */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  /** Weighted-average cost the component was issued at (set on production). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCost!: number;

  /** quantity × unitCost — the component's contribution to the product cost. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  lineCost!: number;
}
