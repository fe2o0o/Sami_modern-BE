import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesLineType } from '../../sales-invoice/enums/sales-invoice.enum';
import { SalesDelivery } from './sales-delivery.entity';

/** One delivered line: the quantity of a product issued out of a warehouse. */
@Entity('sales_delivery_items')
export class SalesDeliveryItem extends BaseEntity {
  @ManyToOne(() => SalesDelivery, (d) => d.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sales_delivery_id' })
  salesDelivery!: SalesDelivery;

  @Column({ type: 'uuid' })
  salesDeliveryId!: string;

  /** The invoice line this fulfils (null for a standalone delivery). */
  @Column({ type: 'uuid', nullable: true })
  salesInvoiceItemId!: string | null;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid', nullable: true })
  unitId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  productCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

  /** Delivered quantity of THIS record (legacy note model). */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  // ── Living-order model (per-line confirmation) ──
  /** Total quantity to deliver for this line (from the invoice). */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  orderedQuantity!: number;

  /** Quantity confirmed/delivered so far (accumulates across confirmations). */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  deliveredQuantity!: number;

  /** Actual delivery date of the last confirmation on this line. */
  @Column({ type: 'date', nullable: true })
  actualDeliveryDate!: string | null;

  /** STOCK lines deliver from inventory; MANUFACTURING lines wait for production. */
  @Column({ type: 'enum', enum: SalesLineType, default: SalesLineType.STOCK })
  lineType!: SalesLineType;

  /** Weighted-average unit cost the goods were issued at (COGS basis). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCostAtPost!: number;

  /** quantity × unitCostAtPost — the line's cost of sales. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  lineCost!: number;
}
