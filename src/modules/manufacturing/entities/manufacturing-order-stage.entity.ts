import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/** Where one stage of an order stands. */
export enum OrderStageStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export const ORDER_STAGE_STATUS_LABELS: Record<OrderStageStatus, string> = {
  [OrderStageStatus.PENDING]: 'لم تبدأ',
  [OrderStageStatus.IN_PROGRESS]: 'جارية',
  [OrderStageStatus.DONE]: 'تمت',
};

/**
 * One production stage of an INTERNAL manufacturing order, copied from the
 * product's route and moved forward by the operations supervisor. This is the
 * PRODUCT's progress (تقطيع → … → تشطيب) — separate from the order's own status.
 */
@Entity('manufacturing_order_stages')
export class ManufacturingOrderStage extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  manufacturingOrderId!: string;

  /** The master stage (kept for filtering); the name is a snapshot. */
  @Column({ type: 'uuid', nullable: true })
  stageId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  stageName!: string;

  @Column({ type: 'int', default: 1 })
  sequence!: number;

  @Column({ type: 'int', nullable: true })
  expectedDays!: number | null;

  @Column({ type: 'varchar', length: 20, default: OrderStageStatus.PENDING })
  status!: OrderStageStatus;

  @Column({ type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  startedBy!: string | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  completedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
