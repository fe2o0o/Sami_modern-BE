import { DataSource } from 'typeorm';
import { FiscalYear } from '../../modules/fiscal-year/entities/fiscal-year.entity';
import { Seeder } from './seeder.interface';

/**
 * First-system initialization: if no fiscal year exists, create the current
 * calendar year as the current, open period. (The Setup Wizard will later let
 * the administrator supply explicit dates.)
 */
export class FiscalYearSeeder implements Seeder {
  readonly name = 'FiscalYearSeeder';

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(FiscalYear);
    if (await repo.count()) {
      return;
    }

    const year = new Date().getFullYear();
    await repo.save(
      repo.create({
        name: `FY${year}`,
        code: `${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        isCurrent: true,
        isClosed: false,
      }),
    );
  }
}
