import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  /** QC server: its own checkout (branch `qc`), `.env`, database and PM2 app. */
  Qc = 'qc',
  Production = 'production',
  Test = 'test',
  Provision = 'provision',
}

/**
 * Strongly-typed schema for the process environment. Validated once at
 * bootstrap; the app refuses to start if required variables are missing or
 * malformed.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(Environment)
  NODE_ENV?: Environment;

  @IsOptional()
  @IsNumber()
  PORT?: number;

  // --- Database ---
  @IsString()
  DB_HOST!: string;

  @IsNumber()
  DB_PORT!: number;

  @IsString()
  DB_USERNAME!: string;

  @IsOptional()
  @IsString()
  DB_PASSWORD?: string;

  @IsString()
  DB_DATABASE!: string;

  // --- JWT (both secrets are mandatory; no insecure fallbacks) ---
  @IsString()
  JWT_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  // --- AI ERP Assistant (optional; the /ai/chat endpoint is disabled without a key) ---
  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_MODEL?: string;
}

/**
 * ConfigModule `validate` hook. Coerces + validates the raw env object.
 */
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => `  - ${Object.values(e.constraints ?? {}).join(', ')}`)
        .join('\n')}`,
    );
  }

  // Database isolation: a QC process must never point at the production
  // database (and vice versa). The server's `.env` decides the environment, so
  // the database name has to say the same thing.
  const db = validated.DB_DATABASE ?? '';
  if (validated.NODE_ENV === Environment.Qc && !/qc/i.test(db)) {
    throw new Error(`NODE_ENV=qc but DB_DATABASE="${db}" is not a QC database (its name must contain "qc").`);
  }
  if (validated.NODE_ENV === Environment.Production && /(qc|test|dev|staging)/i.test(db)) {
    throw new Error(`NODE_ENV=production but DB_DATABASE="${db}" looks like a non-production database.`);
  }

  return validated;
}
