import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Landed expenses on purchase invoices (مصاريف محمّلة: freight, loading …): stored on
 * the invoice (`landed_expenses` JSON), spread onto each line (`landed_cost`) and paid
 * at posting by payment vouchers linked back to the invoice (`vouchers.source_*`). They
 * pass through the «مصاريف مشتريات تحت التسوية» clearing account
 * (`accounting_settings.purchase_expenses_clearing_account_id`). Additive only.
 */
export class PurchaseLandedExpenses1793500000000 implements MigrationInterface {
  name = 'PurchaseLandedExpenses1793500000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('purchase_invoices', 'landed_expenses'))) {
      await q.query('ALTER TABLE `purchase_invoices` ADD `landed_expenses` json NULL');
    }
    if (!(await q.hasColumn('purchase_invoice_items', 'landed_cost'))) {
      await q.query('ALTER TABLE `purchase_invoice_items` ADD `landed_cost` decimal(18,2) NOT NULL DEFAULT 0');
    }
    if (!(await q.hasColumn('accounting_settings', 'purchase_expenses_clearing_account_id'))) {
      await q.query('ALTER TABLE `accounting_settings` ADD `purchase_expenses_clearing_account_id` varchar(36) NULL');
    }
    if (!(await q.hasColumn('vouchers', 'source_type'))) {
      await q.query('ALTER TABLE `vouchers` ADD `source_type` varchar(40) NULL');
      await q.query('ALTER TABLE `vouchers` ADD `source_id` varchar(36) NULL');
      await q.query('ALTER TABLE `vouchers` ADD `source_number` varchar(50) NULL');
      await q.query('CREATE INDEX `IDX_vouchers_source` ON `vouchers` (`source_type`, `source_id`)');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('vouchers', 'source_type')) {
      await q.query('DROP INDEX `IDX_vouchers_source` ON `vouchers`');
      await q.query('ALTER TABLE `vouchers` DROP COLUMN `source_number`');
      await q.query('ALTER TABLE `vouchers` DROP COLUMN `source_id`');
      await q.query('ALTER TABLE `vouchers` DROP COLUMN `source_type`');
    }
    await q.query('ALTER TABLE `accounting_settings` DROP COLUMN `purchase_expenses_clearing_account_id`');
    await q.query('ALTER TABLE `purchase_invoice_items` DROP COLUMN `landed_cost`');
    await q.query('ALTER TABLE `purchase_invoices` DROP COLUMN `landed_expenses`');
  }
}
