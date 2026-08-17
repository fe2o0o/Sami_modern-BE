import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { OpeningBalanceReferenceType } from '../enums/opening-balance.enum';
import { OpeningBalance } from './opening-balance.entity';

/**
 * A single line of an opening balance. The meaningful columns depend on
 * `referenceType`:
 *  - GENERAL_LEDGER / CASH / BANK → accountId + debit/credit
 *  - CUSTOMER / SUPPLIER          → customerId/supplierId + debit/credit
 *  - INVENTORY                    → warehouseId + productId + quantity + unitCost
 *
 * The customer/supplier/warehouse/product columns are nullable and unconstrained
 * for now (those master-data modules don't exist yet); they keep the schema
 * ready so future modules post through the same table without a migration.
 */
@Entity('opening_balance_details')
export class OpeningBalanceDetail extends BaseEntity {
  @ManyToOne(() => OpeningBalance, (ob) => ob.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opening_balance_id' })
  openingBalance!: OpeningBalance;

  @Column({ type: 'uuid' })
  openingBalanceId!: string;

  @Column({ type: 'enum', enum: OpeningBalanceReferenceType })
  referenceType!: OpeningBalanceReferenceType;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  // Ledger account (GL / cash / bank rows)
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null;

  // Master-data references (future modules)
  @Column({ type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  productId!: string | null;

  // Operational cash/bank entities (CASH → treasury, BANK → bank account).
  // The GL `accountId` above is DERIVED from these at save time.
  @Column({ type: 'uuid', nullable: true })
  treasuryId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  bankAccountId!: string | null;

  /** Branch this line belongs to (derived from treasury/bank/warehouse). */
  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  // Inventory quantities
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 3,
    default: 0,
    transformer: numericTransformer,
  })
  quantity!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  unitCost!: number;

  // Money
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  debit!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  credit!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes!: string | null;

  /** True for the auto-generated opening-balance-equity balancing line. */
  @Column({ type: 'boolean', default: false })
  isSystemGenerated!: boolean;
}
