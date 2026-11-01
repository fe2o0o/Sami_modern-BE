import { MigrationInterface, QueryRunner } from 'typeorm';

const BEFORE = `'cash','bank','accounts_receivable','inventory_raw_material','inventory_wip','inventory_finished_goods','fixed_asset','tax_receivable','accounts_payable','tax_payable','salary_payable','other_payable','capital','retained_earnings','opening_balance_equity','sales_revenue','export_revenue','sales_return','other_revenue','cogs','inventory_adjustment','operating_expense','manufacturing_expense','other_expense'`;

/**
 * New asset sub-type «ذمم مدينة أخرى (موظفون ومدينون متنوعون)» for amounts owed by
 * non-customers — employee advances, employee custody, sundry debtors. The
 * advances / custody accounts already chosen in the accounting settings get it
 * when they have no sub-type yet (an existing sub-type is never overwritten).
 */
export class OtherReceivableSubType1792000000000 implements MigrationInterface {
  name = 'OtherReceivableSubType1792000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`chart_of_accounts\` MODIFY \`account_sub_type\` enum (${BEFORE},'other_receivable') NULL`);
    await q.query(`
      UPDATE \`chart_of_accounts\` a
        JOIN \`accounting_settings\` s ON a.\`id\` IN (s.\`employee_advances_account_id\`, s.\`employee_custody_account_id\`)
         SET a.\`account_sub_type\` = 'other_receivable'
       WHERE a.\`account_sub_type\` IS NULL AND a.\`account_type\` = 'asset'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE \`chart_of_accounts\` SET \`account_sub_type\` = NULL WHERE \`account_sub_type\` = 'other_receivable'`);
    await q.query(`ALTER TABLE \`chart_of_accounts\` MODIFY \`account_sub_type\` enum (${BEFORE}) NULL`);
  }
}
