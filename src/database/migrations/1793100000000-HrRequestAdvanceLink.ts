import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Advance requests from «بوابة الموظف»: approving one in the ERP creates an
 * approved employee advance (no money moves); the request keeps its id here and
 * closes when the advance is paid / cancelled from the advances page.
 * Additive only.
 */
export class HrRequestAdvanceLink1793100000000 implements MigrationInterface {
  name = 'HrRequestAdvanceLink1793100000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('hr_requests', 'advance_id'))) {
      await q.query('ALTER TABLE `hr_requests` ADD `advance_id` varchar(36) NULL');
      await q.query('CREATE INDEX `IDX_hr_requests_advance` ON `hr_requests` (`advance_id`)');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('hr_requests', 'advance_id')) {
      await q.query('DROP INDEX `IDX_hr_requests_advance` ON `hr_requests`');
      await q.query('ALTER TABLE `hr_requests` DROP COLUMN `advance_id`');
    }
  }
}
