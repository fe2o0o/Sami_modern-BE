import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional branch on an opening-balance document: its general-ledger lines
 *  (which have no branch of their own) are tagged with it. Additive, nullable. */
export class OpeningBalanceBranch1790800000001 implements MigrationInterface {
  name = 'OpeningBalanceBranch1790800000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`opening_balances\` ADD \`branch_id\` varchar(36) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`opening_balances\` DROP COLUMN \`branch_id\``);
  }
}
