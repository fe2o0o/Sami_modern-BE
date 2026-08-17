import appConfig from './app.config';
import databaseConfig from './database.config';
import jwtConfig from './jwt.config';
import swaggerConfig from './swagger.config';

/** All namespaced configuration factories, loaded by the ConfigModule. */
export const configurations = [
  appConfig,
  databaseConfig,
  jwtConfig,
  swaggerConfig,
];

export { appConfig, databaseConfig, jwtConfig, swaggerConfig };
export * from './env.validation';
