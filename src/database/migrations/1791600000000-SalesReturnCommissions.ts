import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * A sales return now takes back the employees' commission on the returned
 * products: one row per invoice commission line per return, and the return's
 * total on its header. Existing returns stay at 0 (no back-fill). Additive.
 */
export class SalesReturnCommissions1791600000000 implements MigrationInterface {
  name = 'SalesReturnCommissions1791600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`sales_return_commissions\` (${BASE}, \`sales_return_id\` varchar(36) NOT NULL, \`sales_invoice_id\` varchar(36) NOT NULL, \`sales_invoice_commission_id\` varchar(36) NOT NULL, \`employee_id\` varchar(36) NOT NULL, \`employee_name\` varchar(255) NULL, \`commission_type\` enum ('percentage','fixed') NOT NULL DEFAULT 'percentage', \`value\` decimal(18,2) NOT NULL DEFAULT 0, \`returned_base\` decimal(18,2) NOT NULL DEFAULT 0, \`amount\` decimal(18,2) NOT NULL DEFAULT 0, INDEX \`IDX_sales_return_commissions_return\` (\`sales_return_id\`), INDEX \`IDX_sales_return_commissions_invoice\` (\`sales_invoice_id\`), INDEX \`IDX_sales_return_commissions_employee\` (\`employee_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`sales_returns\` ADD \`commission_returned\` decimal(18,2) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_returns\` DROP COLUMN \`commission_returned\``);
    await q.query(`DROP TABLE \`sales_return_commissions\``);
  }
}
