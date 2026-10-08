import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import swaggerConfig from './swagger.config';
import aiConfig from './ai.config';

/** All namespaced configuration factories, loaded by the ConfigModule. */
export const configurations = [
  appConfig,
  databaseConfig,
  jwtConfig,
  swaggerConfig,
  aiConfig,
];

export { appConfig, databaseConfig, jwtConfig, swaggerConfig, aiConfig };
export * from './env.validation';
