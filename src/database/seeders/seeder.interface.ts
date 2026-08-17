import { DataSource } from 'typeorm';

/**
 * Contract every database seeder implements.
 *
 * Seeders populate reference/lookup data (roles, permissions, default
 * settings, chart-of-accounts templates, …) in an idempotent way.
 * Concrete seeders will be added once entities exist.
 */
export interface Seeder {
  /** Human-readable name, used for logging & ordering. */
  readonly name: string;

  /** Insert the seed data. Must be safe to run multiple times. */
  run(dataSource: DataSource): Promise<void>;
}
