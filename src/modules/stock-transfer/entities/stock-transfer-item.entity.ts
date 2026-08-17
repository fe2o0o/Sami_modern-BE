import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { StockTransfer } from './stock-transfer.entity';

/** One product line of a stock transfer. `unitCost` is captured at posting. */
@Entity('stock_transfer_items')
export class StockTransferItem extends BaseEntity {
  @ManyToOne(() => StockTransfer, (t) => t.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stock_transfer_id' })
  transfer!: StockTransfer;

  @Column({ type: 'uuid' })
  stockTransferId!: string;

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

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  /** Weighted-average cost the quantity was transferred at (set on posting). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  unitCost!: number;
}
