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

  return validated;
}
