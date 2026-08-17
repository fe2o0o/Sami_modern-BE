import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { PurchaseDiscountType } from '../../purchase-invoice/enums/purchase-invoice.enum';
import { PurchaseReturn } from './purchase-return.entity';

/** One returned line, prorated from the original purchase-invoice line. */
@Entity('purchase_return_items')
export class PurchaseReturnItem extends BaseEntity {
  @ManyToOne(() => PurchaseReturn, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_return_id' })
  purchaseReturn!: PurchaseReturn;

  @Column({ type: 'uuid' })
  purchaseReturnId!: string;

  @Column({ type: 'uuid', nullable: true })
  purchaseInvoiceItemId!: string | null;

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

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitPrice!: number;

  @Column({ type: 'enum', enum: PurchaseDiscountType, default: PurchaseDiscountType.FIXED })
  discountType!: PurchaseDiscountType;

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

  /** Net unit cost the item was received into inventory at. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCostAtPost!: number;
}
