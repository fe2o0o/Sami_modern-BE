import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesDiscountType, SalesLineType } from '../enums/sales-invoice.enum';
import { SalesInvoice } from './sales-invoice.entity';

/**
 * One line of a sales invoice. Financial figures and the product/unit names are
 * SNAPSHOTS taken when the line is saved, so a historical invoice never changes
 * when the product master later changes. `costAtPost` is the weighted-average
 * unit cost captured at posting time — used for COGS and to reverse a return at
 * the original cost, never at today's cost.
 */
@Entity('sales_invoice_items')
export class SalesInvoiceItem extends BaseEntity {
  @ManyToOne(() => SalesInvoice, (invoice) => invoice.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sales_invoice_id' })
  salesInvoice!: SalesInvoice;

  @Column({ type: 'uuid' })
  salesInvoiceId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  /** Warehouse this line is issued from (null for MANUFACTURING/made-to-order). */
  @Column({ type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  unitId!: string | null;

  /** STOCK (sold from inventory) or MANUFACTURING (made-to-order → production order). */
  @Column({ type: 'enum', enum: SalesLineType, default: SalesLineType.STOCK })
  lineType!: SalesLineType;

  // ── Manufacturing spec (only for MANUFACTURING lines) ──
  @Column({ type: 'date', nullable: true })
  deliveryDate!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dimensions!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  material!: string | null;

  @Column({ type: 'text', nullable: true })
  specifications!: string | null;

  // ── Snapshots ──
  @Column({ type: 'varchar', length: 50, nullable: true })
  productCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

  // ── Financials ──
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitPrice!: number;

  @Column({ type: 'enum', enum: SalesDiscountType, default: SalesDiscountType.FIXED })
  discountType!: SalesDiscountType;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  discountValue!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  discountAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  netBeforeTax!: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0, transformer: numericTransformer })
  vatRate!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  vatAmount!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  lineTotal!: number;

  /** Weighted-average unit cost captured at posting (legacy — cost is now booked at delivery). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  costAtPost!: number;

  /** How much of this line has been shipped via delivery notes (≤ quantity). */
  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  deliveredQuantity!: number;
}
