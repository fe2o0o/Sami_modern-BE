import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * System-wide default accounts used by the transactional modules
 * (sales, purchasing, inventory, treasury, taxes) when posting to the ledger.
 *
 * There is exactly ONE row for the whole company — no create/delete/list, only
 * view + update. Every field stores the **account id** of an active posting
 * account from the chart of accounts; the account code is never stored here.
 */
@Entity('accounting_settings')
export class AccountingSetting extends BaseEntity {
  // ── Sales ──────────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  salesRevenueAccountId!: string | null;

  // NOTE: the generic `purchaseAccountId` was removed — purchases post to the
  // correct inventory/expense account based on the line/item classification,
  // never to a single blanket purchase account.

  // ── Inventory ──────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  rawMaterialInventoryAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  finishedGoodsInventoryAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  costOfGoodsSoldAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  inventoryAdjustmentAccountId!: string | null;

  // ── Customers & Suppliers ──────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  customerControlAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  supplierControlAccountId!: string | null;

  // ── Cash & Banks ───────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  defaultCashAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  defaultBankAccountId!: string | null;

  // ── Taxes ──────────────────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  inputVatAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  outputVatAccountId!: string | null;

  // ── Sales Commission ───────────────────────────────────
  @Column({ type: 'uuid', nullable: true })
  commissionExpenseAccountId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  commissionPayableAccountId!: string | null;

  // ── Opening Balances ───────────────────────────────────
  /** Equity account used to auto-balance opening balances. */
  @Column({ type: 'uuid', nullable: true })
  openingBalanceEquityAccountId!: string | null;
}
