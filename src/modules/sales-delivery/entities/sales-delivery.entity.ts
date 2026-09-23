import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import {
  SalesDeliveryProgress,
  SalesDeliverySource,
  SalesDeliveryStatus,
} from '../enums/sales-delivery.enum';
import { SalesDeliveryItem } from './sales-delivery-item.entity';

/**
 * A delivery note (إذن تسليم / صرف بضاعة): the document that physically issues
 * goods out of a warehouse and books the cost of sales. It may fulfil a posted
 * sales invoice (releasing that invoice's reservation) or stand alone.
 */
@Entity('sales_deliveries')
export class SalesDelivery extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  deliveryNumber!: string | null;

  /** Document date of the order. */
  @Column({ type: 'date' })
  deliveryDate!: string;

  /** Planned/expected delivery date entered by the user (required at app level). */
  @Column({ type: 'date', nullable: true })
  expectedDeliveryDate!: string | null;

  /** Roll-up fulfilment progress of the order's lines. */
  @Column({ type: 'enum', enum: SalesDeliveryProgress, default: SalesDeliveryProgress.PENDING })
  deliveryProgress!: SalesDeliveryProgress;

  @Column({ type: 'enum', enum: SalesDeliverySource, default: SalesDeliverySource.INVOICE })
  source!: SalesDeliverySource;

  @Column({ type: 'uuid', nullable: true })
  salesInvoiceId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoiceNumber!: string | null;

  @Column({ type: 'uuid' })
  customerId!: string;

  /** Header warehouse. Null for a manufacturing-only order (each line carries its
   *  own warehouse, assigned to a manufacturing line at production time). */
  @Column({ type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  /** Total cost of goods issued (weighted-average) — the COGS amount booked. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalCost!: number;

  @Column({ type: 'enum', enum: SalesDeliveryStatus, default: SalesDeliveryStatus.DRAFT })
  status!: SalesDeliveryStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

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

  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @OneToMany(() => SalesDeliveryItem, (item) => item.salesDelivery, { cascade: true })
  items!: SalesDeliveryItem[];

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
