import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesInvoiceItem } from './sales-invoice-item.entity';

/**
 * A per-order Bill-of-Materials line entered on a MANUFACTURING sales-invoice
 * line. It defines how THIS ordered product is produced (for this invoice only)
 * WITHOUT touching the product master's default BOM. `quantity` is per one unit
 * of the ordered product; posting copies it (× line quantity) into the spawned
 * manufacturing order's components.
 */
@Entity('sales_invoice_item_components')
export class SalesInvoiceItemComponent extends BaseEntity {
  @ManyToOne(() => SalesInvoiceItem, (i) => i.components, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sales_invoice_item_id' })
  salesInvoiceItem!: SalesInvoiceItem;

  @Index()
  @Column({ type: 'uuid' })
  salesInvoiceItemId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  componentProductId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  componentProductName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

  /** Warehouse this component is drawn from (a warehouse of the invoice's branch). */
  @Column({ type: 'uuid', nullable: true })
  warehouseId!: string | null;

  /** Units of the component required to produce ONE unit of the ordered product. */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;
}
