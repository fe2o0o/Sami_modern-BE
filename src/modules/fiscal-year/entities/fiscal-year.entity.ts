import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { AccountingPeriod } from '../../accounting-period/entities/accounting-period.entity';

/**
 * Accounting period that owns every business transaction (invoices, purchases,
 * journal entries, inventory movements, vouchers, …). Exactly one fiscal year
 * is "current" at a time; a closed year is read-only.
 */
@Entity('fiscal_years')
export class FiscalYear extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'boolean', default: false })
  isCurrent!: boolean;

  @Column({ type: 'boolean', default: false })
  isClosed!: boolean;

  @Column({ type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => AccountingPeriod, (period) => period.fiscalYear)
  periods!: AccountingPeriod[];

  // =========================
  // AUDIT (who)
  // =========================
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
