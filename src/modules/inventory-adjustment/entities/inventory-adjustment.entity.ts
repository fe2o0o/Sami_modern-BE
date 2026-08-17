import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { InventoryAdjustmentStatus } from '../enums/inventory-adjustment.enum';
import { InventoryAdjustmentItem } from './inventory-adjustment-item.entity';

/**
 * A stock adjustment document — manually increases (surplus) or decreases
 * (shortage/damage) on-hand quantities in a warehouse. On POSTING, in one
 * transaction: stock is moved and one balanced journal entry posts against the
 * inventory-adjustment account. A DRAFT has no effect.
 */
@Entity('inventory_adjustments')
export class InventoryAdjustment extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  adjustmentNumber!: string | null;

  @Index()
  @Column({ type: 'date' })
  adjustmentDate!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

  @Column({ type: 'uuid' })
  accountingPeriodId!: string;

  @Index()
  @Column({ type: 'enum', enum: InventoryAdjustmentStatus, default: InventoryAdjustmentStatus.DRAFT })
  status!: InventoryAdjustmentStatus;

  /** Net value: Σ(increase value) − Σ(decrease value). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  totalValue!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId!: string | null;

  @Column({ type: 'datetime', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedBy!: string | null;

  // ── Reversal ──
  @Column({ type: 'datetime', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reversedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  reversalReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reversalJournalEntryId!: string | null;

  @OneToMany(() => InventoryAdjustmentItem, (i) => i.adjustment, { cascade: true })
  items!: InventoryAdjustmentItem[];

  // ── Audit ──
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
