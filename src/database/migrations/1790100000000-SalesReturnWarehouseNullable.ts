import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A sales return of a SERVICE (or any non-inventory) line never touches stock,
 * so neither the return header nor such lines need a warehouse. Loosen the
 * NOT NULL constraints; stock lines still always carry their warehouse.
 */
export class SalesReturnWarehouseNullable1790100000000 implements MigrationInterface {
  name = 'SalesReturnWarehouseNullable1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`sales_returns\` MODIFY \`warehouse_id\` varchar(36) NULL`);
    await queryRunner.query(`ALTER TABLE \`sales_return_items\` MODIFY \`warehouse_id\` varchar(36) NULL`);
    // Services were created with the default trackInventory = true; a service
    // never has stock, and that flag made returns try to receive it into a warehouse.
    await queryRunner.query(`UPDATE \`products\` SET \`track_inventory\` = 0 WHERE \`product_type\` = 'service'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`sales_return_items\` MODIFY \`warehouse_id\` varchar(36) NOT NULL`);
    await queryRunner.query(`ALTER TABLE \`sales_returns\` MODIFY \`warehouse_id\` varchar(36) NOT NULL`);
  }
}
