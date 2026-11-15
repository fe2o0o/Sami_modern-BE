import { MigrationInterface, QueryRunner } from 'typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * FAMRIX rebrand — data only, NO schema change.
 * The logo that used to be baked into the frontend becomes the company's own logo
 * (first company SAMI-001 only, and only when no logo is set), so printed
 * documents keep showing it. No business data is touched.
 */
export class CompanyLogoFromBranding1793300000000 implements MigrationInterface {
  name = 'CompanyLogoFromBranding1793300000000';

  public async up(q: QueryRunner): Promise<void> {
    const rows: { id: string }[] = await q.query(
      "SELECT `id` FROM `companies` WHERE `code` = 'SAMI-001' AND (`logo` IS NULL OR `logo` = '') AND `deleted_at` IS NULL",
    );
    if (!rows.length) return;
    const name = 'logo-sami-001.png';
    try {
      const dir = join(process.cwd(), 'uploads', 'company');
      await fs.mkdir(dir, { recursive: true });
      await fs.copyFile(join(process.cwd(), 'src', 'database', 'seed-assets', 'company-logo-sami-001.png'), join(dir, name));
    } catch {
      return; // asset missing in this checkout — upload the logo from the company settings screen
    }
    await q.query('UPDATE `companies` SET `logo` = ? WHERE `id` = ?', [`/uploads/company/${name}`, rows[0].id]);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("UPDATE `companies` SET `logo` = NULL WHERE `logo` = '/uploads/company/logo-sami-001.png'");
  }
}
