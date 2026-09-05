import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

// Load environment variables for the standalone TypeORM CLI context
// (migrations run outside the Nest DI container).
loadEnv();

/**
 * Reusable TypeORM data source.
 *
 * Used by:
 *  - the TypeORM CLI (migration generate/run/revert)
 *  - the Nest TypeOrmModule factory (see app.module.ts) via `dataSourceOptions`
 *
 * `synchronize` is OFF — schema changes are applied through migrations only.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'sami_modern',
  // Entities & migrations are discovered by glob; none exist yet.
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  namingStrategy: new SnakeNamingStrategy(),
  // NEVER auto-sync in production. This DataSource is what the migration CLI
  // initializes, so a `true` here would auto-alter the schema before migrating.
  // Opt in explicitly (dev only) with DB_SYNCHRONIZE=true; production forces off.
  synchronize:
    process.env.NODE_ENV !== 'production' &&
    process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.DB_LOGGING === 'true',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
