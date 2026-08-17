import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * A named, monotonically-increasing counter used to generate gap-tolerant
 * document numbers (journal entries now; invoices, vouchers, … later).
 *
 * One row per logical sequence, addressed by `key` (e.g. `JE:<fiscalYearId>`).
 * The number is advanced under a pessimistic row lock inside the caller's
 * transaction, so concurrent requests never read the same value.
 */
@Entity('document_sequences')
export class DocumentSequence extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'int', default: 0, unsigned: true })
  lastNumber!: number;
}
