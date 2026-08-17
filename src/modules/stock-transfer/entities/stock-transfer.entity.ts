import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { StockTransferStatus } from '../enums/stock-transfer.enum';
import { StockTransferItem } from './stock-transfer-item.entity';

/**
 * A stock transfer document — moves quantities of products from one warehouse to
 * another at the same weighted-average cost. No accounting effect (the same GL
 * inventory account is on both sides). A DRAFT has no effect.
 */
@Entity('stock_transfers')
export class StockTransfer extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  transferNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  transferDate!: string;

  @Column({ type: 'uuid' })
  fromWarehouseId!: string;

  @Column({ type: 'uuid' })
  toWarehouseId!: string;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Index()
  @Column({ type: 'enum', enum: StockTransferStatus, default: StockTransferStatus.DRAFT })
  status!: StockTransferStatus;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalValue!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @OneToMany(() => StockTransferItem, (i) => i.transfer, { cascade: true })
  items!: StockTransferItem[];

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
