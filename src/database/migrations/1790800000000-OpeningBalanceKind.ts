import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supplementary opening balances: a fiscal year keeps ONE primary opening
 * balance, plus any number of «رصيد افتتاحي إضافي» documents (e.g. a branch
 * added later). Each posts its own journal/stock/cash entries and never edits
 * the already-posted one. Additive: existing rows default to 'primary'.
 */
export class OpeningBalanceKind1790800000000 implements MigrationInterface {
  name = 'OpeningBalanceKind1790800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`opening_balances\` ADD \`kind\` varchar(20) NOT NULL DEFAULT 'primary'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`opening_balances\` DROP COLUMN \`kind\``);
  }
}
