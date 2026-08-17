import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { ManufacturingOrderStatus } from '../enums/manufacturing.enum';

/**
 * A manufacturing (production) order — a made-to-order production request that
 * captures HOW a product should be produced for a customer (dimensions, color,
 * material, free-text spec, delivery date) and tracks its status. It has NO
 * stock or accounting effect; it is usually created automatically from a sales
 * invoice line flagged as "manufacturing" and linked back to that invoice via
 * `sourceType`/`sourceId`.
 */
@Entity('manufacturing_orders')
export class ManufacturingOrder extends BaseEntity {
  /** Assigned on creation, e.g. MO-2026-000001. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  orderNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  orderDate!: string;

  /** The base product being produced. */
  @Index()
  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  productName!: string | null;

  /** The customer the production is for (from the invoice, when applicable). */
  @Column({ type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customerName!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 3, default: 0, transformer: numericTransformer })
  quantity!: number;

  // ── Customer specification ──
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

  @Index()
  @Column({ type: 'enum', enum: ManufacturingOrderStatus, default: ManufacturingOrderStatus.NEW })
  status!: ManufacturingOrderStatus;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  fiscalYearId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // ── Source link (the sales invoice that requested this order) ──
  @Column({ type: 'varchar', length: 50, nullable: true })
  sourceType!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceNumber!: string | null;

  // ── Status timestamps ──
  @Column({ type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'datetime', nullable: true })
  doneAt!: Date | null;

  // ── Audit ──
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
