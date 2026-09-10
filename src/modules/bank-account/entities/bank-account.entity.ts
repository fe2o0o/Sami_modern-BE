import { Column, Entity, Index, JoinTable, ManyToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Branch } from '../../branch/entities/branch.entity';

/**
 * A physical bank account — an OPERATIONAL entity, distinct from the GL bank
 * account. `accountId` maps it to the chart-of-account bank account it posts to;
 * several bank accounts may share one GL account while their operational
 * balances stay separate.
 *
 * A bank account may serve MANY branches (`branches`). An EMPTY branch set means
 * the account is shared/available to every branch (a central account).
 */
@Entity('bank_accounts')
export class BankAccount extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  bankName!: string;

  @Column({ type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  accountNumber!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  iban!: string | null;

  /** Branches this account serves. EMPTY = available to all branches. */
  @ManyToMany(() => Branch)
  @JoinTable({
    name: 'bank_account_branches',
    joinColumn: { name: 'bank_account_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'branch_id', referencedColumnName: 'id' },
  })
  branches!: Branch[];

  /** GL bank account this account posts to. */
  @Column({ type: 'uuid' })
  accountId!: string;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currencyCode!: string;

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
