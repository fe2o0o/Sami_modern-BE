import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Branch } from '../../branch/entities/branch.entity';

/**
 * A physical treasury / cashbox where cash is actually held. It is an
 * OPERATIONAL entity — distinct from the chart-of-account. `accountId` maps it
 * to the GL cash account used when its movements post to the ledger; several
 * treasuries may legitimately share one GL account (the operational balance
 * stays per-treasury, the GL aggregates them).
 */
@Entity('treasuries')
export class Treasury extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index()
  @Column({ type: 'uuid' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;

  /** GL cash account this treasury posts to. */
  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // Audit
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
