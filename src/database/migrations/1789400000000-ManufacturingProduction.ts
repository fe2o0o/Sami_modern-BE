import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Manufacturing production.
 *
 * - `product_components`: a manufactured product's Bill of Materials (parent →
 *   component stock product + per-unit quantity).
 * - `manufacturing_order_components`: the BOM copied onto a production order,
 *   editable, with the issued cost captured at production time.
 * - `manufacturing_orders` gains production inputs (warehouse, fee, factory
 *   supplier) and results (total cost, journal entry, produced-at) plus a
 *   back-link to the exact sales invoice line, and a new `produced` status.
 * - `sales_delivery_items` gains `manufacturing_order_id` so a manufacturing
 *   delivery line becomes confirmable once its order is produced.
 * - `accounting_settings` gains `manufacturing_fee_account_id`.
 */
export class ManufacturingProduction1789400000000 implements MigrationInterface {
  name = 'ManufacturingProduction1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── BOM on the product ──
    await queryRunner.query(`
      CREATE TABLE \`product_components\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`parent_product_id\` varchar(36) NOT NULL,
        \`component_product_id\` varchar(36) NOT NULL,
        \`quantity\` decimal(18,3) NOT NULL DEFAULT '0.000',
        INDEX \`IDX_product_components_parent\` (\`parent_product_id\`),
        INDEX \`IDX_product_components_component\` (\`component_product_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── BOM copied onto the manufacturing order ──
    await queryRunner.query(`
      CREATE TABLE \`manufacturing_order_components\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`manufacturing_order_id\` varchar(36) NOT NULL,
        \`line_number\` int NOT NULL DEFAULT '1',
        \`component_product_id\` varchar(36) NOT NULL,
        \`component_product_name\` varchar(255) NULL,
        \`unit_name\` varchar(100) NULL,
        \`quantity\` decimal(18,3) NOT NULL DEFAULT '0.000',
        \`unit_cost\` decimal(18,2) NOT NULL DEFAULT '0.00',
        \`line_cost\` decimal(18,2) NOT NULL DEFAULT '0.00',
        INDEX \`IDX_mo_components_order\` (\`manufacturing_order_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    // ── Manufacturing order production fields ──
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`accounting_period_id\` varchar(36) NULL`);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`warehouse_id\` varchar(36) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` ADD \`manufacturing_fee\` decimal(18,2) NOT NULL DEFAULT '0.00'`,
    );
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`factory_supplier_id\` varchar(36) NULL`);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`factory_supplier_name\` varchar(255) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` ADD \`total_cost\` decimal(18,2) NOT NULL DEFAULT '0.00'`,
    );
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`journal_entry_id\` varchar(36) NULL`);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`produced_at\` datetime NULL`);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` ADD \`sales_invoice_item_id\` varchar(36) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` MODIFY \`status\` enum('new','in_progress','produced','done','cancelled') NOT NULL DEFAULT 'new'`,
    );

    // ── Delivery line → manufacturing order link ──
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` ADD \`manufacturing_order_id\` varchar(36) NULL`);
    // A manufacturing delivery line (and a manufacturing-only order header) has no
    // warehouse until production assigns one.
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` MODIFY \`warehouse_id\` varchar(255) NULL`);
    await queryRunner.query(`ALTER TABLE \`sales_deliveries\` MODIFY \`warehouse_id\` varchar(255) NULL`);

    // ── Accounting settings: manufacturing fee credit account ──
    await queryRunner.query(`ALTER TABLE \`accounting_settings\` ADD \`manufacturing_fee_account_id\` varchar(36) NULL`);

    // ── Supplier subledger: a manufacturing-fee payable movement type ──
    await queryRunner.query(
      `ALTER TABLE \`supplier_transactions\` MODIFY \`type\` enum('opening_balance','purchase_invoice','purchase_return','payment','adjustment','reversal','manufacturing_fee') NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`supplier_transactions\` MODIFY \`type\` enum('opening_balance','purchase_invoice','purchase_return','payment','adjustment','reversal') NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`manufacturing_fee_account_id\``);
    await queryRunner.query(`ALTER TABLE \`sales_deliveries\` MODIFY \`warehouse_id\` varchar(255) NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` MODIFY \`warehouse_id\` varchar(255) NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`manufacturing_order_id\``);
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` MODIFY \`status\` enum('new','in_progress','done','cancelled') NOT NULL DEFAULT 'new'`,
    );
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`sales_invoice_item_id\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`produced_at\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`journal_entry_id\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`total_cost\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`factory_supplier_name\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`factory_supplier_id\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`manufacturing_fee\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`warehouse_id\``);
    await queryRunner.query(`ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`accounting_period_id\``);
    await queryRunner.query(`DROP TABLE \`manufacturing_order_components\``);
    await queryRunner.query(`DROP TABLE \`product_components\``);
  }
}
