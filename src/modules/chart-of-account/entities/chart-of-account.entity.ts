import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { AccountNature, AccountSubType, AccountType } from '../enums/account.enum';

/**
 * A node in the chart of accounts. Supports unlimited hierarchy via a
 * self-referencing parent. Every future accounting transaction (sales,
 * purchases, inventory, payroll, vouchers, journal entries) posts against a
 * leaf account with `allowPosting = true`.
 */
@Entity('chart_of_accounts')
export class ChartOfAccount extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  accountCode!: string;

  @Column({ type: 'varchar', length: 255 })
  accountNameAr!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  accountNameEn!: string | null;

  @Column({ type: 'enum', enum: AccountType })
  accountType!: AccountType;

  @Column({ type: 'enum', enum: AccountNature })
  accountNature!: AccountNature;

  /** Fine-grained purpose used for setting-specific filtering (nullable). */
  @Column({ type: 'enum', enum: AccountSubType, nullable: true })
  accountSubType!: AccountSubType | null;

  @Column({ type: 'uuid', nullable: true })
  currencyId!: string | null;

  /** 1 for roots, parent.level + 1 otherwise. Maintained by the service. */
  @Column({ type: 'int', default: 1 })
  level!: number;

  /** Header accounts group other accounts and cannot receive transactions. */
  @Column({ type: 'boolean', default: false })
  isHeader!: boolean;

  /** Only leaf accounts may allow posting. Mutually exclusive with isHeader. */
  @Column({ type: 'boolean', default: true })
  allowPosting!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** Default root accounts — protected from deletion. */
  @Column({ type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // =========================
  // HIERARCHY
  // =========================
  @ManyToOne(() => ChartOfAccount, (account) => account.children, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'parent_id' })
  parent!: ChartOfAccount | null;

  @Column({ type: 'uuid', nullable: true })
  parentId!: string | null;

  @OneToMany(() => ChartOfAccount, (account) => account.parent)
  children!: ChartOfAccount[];

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
