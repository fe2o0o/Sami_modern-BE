import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings a database up to the reserve-at-invoice / issue-at-delivery sales flow,
 * the RBAC `role_permissions` store, the optional-branch warehouse, and the
 * cash-return treasury movement types. DDL mirrors exactly what `synchronize`
 * produced in development.
 *
 * The warehouse→branch FK name (`FK_d1a87bf9de7503bb1b6fc0cb859`) is TypeORM's
 * deterministic hash of (warehouses, branch_id) and is stable across databases.
 */
export class SalesDeliveryReservationAndRbac1788400000000 implements MigrationInterface {
  name = 'SalesDeliveryReservationAndRbac1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- RBAC: role_permissions ----
    await queryRunner.query(`
      CREATE TABLE \`role_permissions\` (
        \`id\` varchar(36) NOT NULL,
        \`role_id\` varchar(255) NOT NULL,
        \`permission_key\` varchar(100) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_role_permission\` (\`role_id\`, \`permission_key\`),
        CONSTRAINT \`FK_178199805b901ccd220ab7740ec\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);

    // ---- Sales delivery notes ----
    await queryRunner.query(`
      CREATE TABLE \`sales_deliveries\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`delivery_number\` varchar(50) NULL,
        \`delivery_date\` date NOT NULL,
        \`source\` enum('invoice','standalone') NOT NULL DEFAULT 'invoice',
        \`sales_invoice_id\` varchar(255) NULL,
        \`invoice_number\` varchar(50) NULL,
        \`customer_id\` varchar(255) NOT NULL,
        \`warehouse_id\` varchar(255) NOT NULL,
        \`branch_id\` varchar(255) NULL,
        \`fiscal_year_id\` varchar(255) NOT NULL,
        \`accounting_period_id\` varchar(255) NOT NULL,
        \`total_cost\` decimal(18,2) NOT NULL DEFAULT '0.00',
        \`status\` enum('draft','posted','reversed') NOT NULL DEFAULT 'draft',
        \`notes\` text NULL,
        \`journal_entry_id\` varchar(255) NULL,
        \`posted_at\` datetime NULL,
        \`posted_by\` varchar(255) NULL,
        \`reversed_at\` datetime NULL,
        \`reversed_by\` varchar(255) NULL,
        \`reversal_reason\` text NULL,
        \`reversal_journal_entry_id\` varchar(255) NULL,
        \`created_by\` varchar(255) NULL,
        \`updated_by\` varchar(255) NULL,
        \`deleted_by\` varchar(255) NULL,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_3e6f65dd11a606998fdbbd5e47\` (\`delivery_number\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`sales_delivery_items\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL DEFAULT NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`sales_delivery_id\` varchar(255) NOT NULL,
        \`sales_invoice_item_id\` varchar(255) NULL,
        \`line_number\` int NOT NULL DEFAULT '1',
        \`product_id\` varchar(255) NOT NULL,
        \`warehouse_id\` varchar(255) NOT NULL,
        \`unit_id\` varchar(255) NULL,
        \`product_code\` varchar(50) NULL,
        \`product_name\` varchar(255) NULL,
        \`unit_name\` varchar(100) NULL,
        \`quantity\` decimal(18,3) NOT NULL DEFAULT '0.000',
        \`unit_cost_at_post\` decimal(18,2) NOT NULL DEFAULT '0.00',
        \`line_cost\` decimal(18,2) NOT NULL DEFAULT '0.00',
        PRIMARY KEY (\`id\`),
        INDEX \`FK_a5eee84dc05016797e5082d5620\` (\`sales_delivery_id\`),
        CONSTRAINT \`FK_a5eee84dc05016797e5082d5620\` FOREIGN KEY (\`sales_delivery_id\`) REFERENCES \`sales_deliveries\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);

    // ---- Stock reservation + invoice delivery tracking ----
    await queryRunner.query(
      `ALTER TABLE \`warehouse_stock\` ADD \`reserved_quantity\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` ADD \`delivered_quantity\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoices\` ADD \`delivery_status\` enum('not_applicable','pending','partial','delivered') NOT NULL DEFAULT 'pending'`,
    );

    // ---- Warehouse branch is now optional (SET NULL on branch delete) ----
    await queryRunner.query(`ALTER TABLE \`warehouses\` DROP FOREIGN KEY \`FK_d1a87bf9de7503bb1b6fc0cb859\``);
    await queryRunner.query(`ALTER TABLE \`warehouses\` MODIFY \`branch_id\` varchar(255) NULL`);
    await queryRunner.query(
      `ALTER TABLE \`warehouses\` ADD CONSTRAINT \`FK_d1a87bf9de7503bb1b6fc0cb859\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ---- Cash-return treasury movement types ----
    await queryRunner.query(
      `ALTER TABLE \`treasury_transactions\` MODIFY \`type\` enum('opening_balance','receipt','payment','transfer_in','transfer_out','cash_sale','cash_purchase','cash_sale_return','cash_purchase_return','adjustment','reversal') NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`treasury_transactions\` MODIFY \`type\` enum('opening_balance','receipt','payment','transfer_in','transfer_out','cash_sale','cash_purchase','adjustment','reversal') NOT NULL`,
    );

    await queryRunner.query(`ALTER TABLE \`warehouses\` DROP FOREIGN KEY \`FK_d1a87bf9de7503bb1b6fc0cb859\``);
    await queryRunner.query(`ALTER TABLE \`warehouses\` MODIFY \`branch_id\` varchar(255) NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE \`warehouses\` ADD CONSTRAINT \`FK_d1a87bf9de7503bb1b6fc0cb859\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE \`sales_invoices\` DROP COLUMN \`delivery_status\``);
    await queryRunner.query(`ALTER TABLE \`sales_invoice_items\` DROP COLUMN \`delivered_quantity\``);
    await queryRunner.query(`ALTER TABLE \`warehouse_stock\` DROP COLUMN \`reserved_quantity\``);

    await queryRunner.query(`DROP TABLE \`sales_delivery_items\``);
    await queryRunner.query(`DROP TABLE \`sales_deliveries\``);
    await queryRunner.query(`DROP TABLE \`role_permissions\``);
  }
}
