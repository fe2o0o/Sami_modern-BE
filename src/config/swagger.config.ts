import { registerAs } from '@nestjs/config';

/**
 * Swagger / OpenAPI documentation configuration.
 */
export default registerAs('swagger', () => ({
  enabled: process.env.SWAGGER_ENABLED !== 'false',
  title: process.env.SWAGGER_TITLE ?? 'Sami Furniture Accountant API',
  description:
    process.env.SWAGGER_DESCRIPTION ??
    'Sami Furniture Accountant ERP — REST API documentation',
  version: process.env.SWAGGER_VERSION ?? '1.0',
  path: process.env.SWAGGER_PATH ?? 'docs',
}));
