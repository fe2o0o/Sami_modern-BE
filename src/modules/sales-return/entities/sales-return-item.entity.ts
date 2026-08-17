import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesDiscountType, SalesLineType } from '../../sales-invoice/enums/sales-invoice.enum';
import { SalesReturn } from './sales-return.entity';

/**
 * One returned line, mirroring an original sales-invoice line's pricing at the
 * returned quantity. `costAtPost` is the original weighted-average cost the line
 * was sold at — used to reverse COGS and value the returned stock.
 */
@Entity('sales_return_items')
export class SalesReturnItem extends BaseEntity {
  @ManyToOne(() => SalesReturn, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sales_return_id' })
  salesReturn!: SalesReturn;

  @Column({ type: 'uuid' })
  salesReturnId!: string;

  /** The original invoice line this returns against (for quantity capping). */
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

  @Column({ type: 'enum', enum: SalesLineType, default: SalesLineType.STOCK })
  lineType!: SalesLineType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  productCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  unitName!: string | null;

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

  /** Original weighted-average cost the line was sold at. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  costAtPost!: number;
}
