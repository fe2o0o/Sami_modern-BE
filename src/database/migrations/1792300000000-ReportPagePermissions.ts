import { MigrationInterface, QueryRunner } from 'typeorm';

const REPORT_KEYS = [
  'report_profit_loss.view',
  'report_product_income.view',
  'report_product_sales_detail.view',
  'report_delivered_items.view',
  'report_general_ledger.view',
  'report_trial_balance.view',
  'report_income_statement.view',
  'report_balance_sheet.view',
  'report_treasury.view',
  'report_commissions.view',
];
const keysUnion = REPORT_KEYS.map((k) => `SELECT '${k}' AS k`).join(' UNION ALL ');

/**
 * One permission per report page instead of the single `accounting_reports.view`.
 * Every role that held the old key gets all the report keys (nobody loses access),
 * then the old key is removed. Roles can then be narrowed page by page.
 */
export class ReportPagePermissions1792300000000 implements MigrationInterface {
  name = 'ReportPagePermissions1792300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT IGNORE INTO \`role_permissions\` (\`id\`, \`role_id\`, \`permission_key\`, \`created_at\`)
       SELECT UUID(), rp.\`role_id\`, k.k, NOW()
         FROM \`role_permissions\` rp CROSS JOIN (${keysUnion}) k
        WHERE rp.\`permission_key\` = 'accounting_reports.view'`,
    );
    await q.query(`DELETE FROM \`role_permissions\` WHERE \`permission_key\` = 'accounting_reports.view'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const list = REPORT_KEYS.map((k) => `'${k}'`).join(', ');
    await q.query(
      `INSERT IGNORE INTO \`role_permissions\` (\`id\`, \`role_id\`, \`permission_key\`, \`created_at\`)
       SELECT UUID(), r.\`role_id\`, 'accounting_reports.view', NOW()
         FROM (SELECT DISTINCT \`role_id\` FROM \`role_permissions\` WHERE \`permission_key\` IN (${list})) r`,
    );
    await q.query(`DELETE FROM \`role_permissions\` WHERE \`permission_key\` IN (${list})`);
  }
}
