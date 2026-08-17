import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { FiscalYear } from '../../fiscal-year/entities/fiscal-year.entity';

/**
 * A single accounting period (normally one calendar month) inside a fiscal
 * year. Transactions are posted into a period; a closed period is read-only.
 */
@Entity('accounting_periods')
@Index(['fiscalYearId', 'periodNumber'], { unique: true })
export class AccountingPeriod extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'int' })
  periodNumber!: number;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'boolean', default: false })
  isClosed!: boolean;

  @Column({ type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // =========================
  // RELATIONS
  // =========================
  @ManyToOne(() => FiscalYear, (fiscalYear) => fiscalYear.periods, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear!: FiscalYear;

  @Column({ type: 'uuid' })
  fiscalYearId!: string;

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
