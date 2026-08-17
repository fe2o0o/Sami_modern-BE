import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { PurchaseDiscountType } from '../enums/purchase-invoice.enum';
import { PurchaseInvoice } from './purchase-invoice.entity';

/**
 * One line of a purchase invoice. Financial figures and the product/unit names
 * are SNAPSHOTS taken when the line is saved, so a historical invoice never
 * changes when the product master later changes. `unitCostAtPost` is the net
 * (after-discount, pre-VAT) unit cost the line was received into inventory at —
 * used to reverse a return at the original cost, never at today's cost.
 */
@Entity('purchase_invoice_items')
export class PurchaseInvoiceItem extends BaseEntity {
  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'purchase_invoice_id' })
  purchaseInvoice!: PurchaseInvoice;

  @Column({ type: 'uuid' })
  purchaseInvoiceId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid', nullable: true })
  unitId!: string | null;

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

  /** The purchase (buy) unit price before discount/VAT. */
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

  /** Net unit cost captured at posting (for returns / reversal at original cost). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCostAtPost!: number;
}
