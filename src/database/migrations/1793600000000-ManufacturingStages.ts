import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * Internal manufacturing stages (مراحل التصنيع): the master list, each product's
 * route (stages in order + «الترتيب إجباري»), and the per-order stage rows the
 * operations supervisor moves forward — the PRODUCT's progress, separate from the
 * order status. The order keeps a current-stage summary for lists. Additive only.
 */
export class ManufacturingStages1793600000000 implements MigrationInterface {
  name = 'ManufacturingStages1793600000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasTable('manufacturing_stages'))) {
      await q.query(
        `CREATE TABLE \`manufacturing_stages\` (${BASE}, \`name\` varchar(100) NOT NULL, \`name_en\` varchar(100) NULL, \`sort_order\` int NOT NULL DEFAULT 0, \`default_days\` int NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
      );
    }
    if (!(await q.hasTable('product_stages'))) {
      await q.query(
        `CREATE TABLE \`product_stages\` (${BASE}, \`product_id\` varchar(36) NOT NULL, \`stage_id\` varchar(36) NOT NULL, \`sequence\` int NOT NULL DEFAULT 1, \`expected_days\` int NULL, INDEX \`IDX_product_stages_product\` (\`product_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
      );
      await q.query(
        'ALTER TABLE `product_stages` ADD CONSTRAINT `FK_product_stages_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
      );
    }
    if (!(await q.hasTable('manufacturing_order_stages'))) {
      await q.query(
        `CREATE TABLE \`manufacturing_order_stages\` (${BASE}, \`manufacturing_order_id\` varchar(36) NOT NULL, \`stage_id\` varchar(36) NULL, \`stage_name\` varchar(100) NOT NULL, \`sequence\` int NOT NULL DEFAULT 1, \`expected_days\` int NULL, \`status\` varchar(20) NOT NULL DEFAULT 'pending', \`started_at\` datetime NULL, \`started_by\` varchar(36) NULL, \`completed_at\` datetime NULL, \`completed_by\` varchar(36) NULL, \`notes\` text NULL, INDEX \`IDX_manufacturing_order_stages_order\` (\`manufacturing_order_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
      );
    }
    if (!(await q.hasColumn('products', 'stages_strict_order'))) {
      await q.query('ALTER TABLE `products` ADD `stages_strict_order` tinyint NOT NULL DEFAULT 1');
    }
    const mo = 'manufacturing_orders';
    if (!(await q.hasColumn(mo, 'stages_strict_order'))) {
      await q.query(`ALTER TABLE \`${mo}\` ADD \`stages_strict_order\` tinyint NOT NULL DEFAULT 1`);
      await q.query(`ALTER TABLE \`${mo}\` ADD \`current_stage_id\` varchar(36) NULL`);
      await q.query(`ALTER TABLE \`${mo}\` ADD \`current_stage_name\` varchar(100) NULL`);
      await q.query(`ALTER TABLE \`${mo}\` ADD \`current_stage_status\` varchar(20) NULL`);
      await q.query(`ALTER TABLE \`${mo}\` ADD \`stages_done\` int NOT NULL DEFAULT 0`);
      await q.query(`ALTER TABLE \`${mo}\` ADD \`stages_total\` int NOT NULL DEFAULT 0`);
      await q.query(`CREATE INDEX \`IDX_manufacturing_orders_current_stage\` ON \`${mo}\` (\`current_stage_id\`)`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const mo = 'manufacturing_orders';
    if (await q.hasColumn(mo, 'stages_strict_order')) {
      await q.query(`DROP INDEX \`IDX_manufacturing_orders_current_stage\` ON \`${mo}\``);
      for (const c of ['stages_total', 'stages_done', 'current_stage_status', 'current_stage_name', 'current_stage_id', 'stages_strict_order']) {
        await q.query(`ALTER TABLE \`${mo}\` DROP COLUMN \`${c}\``);
      }
    }
    if (await q.hasColumn('products', 'stages_strict_order')) await q.query('ALTER TABLE `products` DROP COLUMN `stages_strict_order`');
    await q.query('DROP TABLE IF EXISTS `manufacturing_order_stages`');
    await q.query('DROP TABLE IF EXISTS `product_stages`');
    await q.query('DROP TABLE IF EXISTS `manufacturing_stages`');
  }
}
