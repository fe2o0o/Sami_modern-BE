import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { join } from 'path';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = config.get<number>('app.port') ?? 3000;
  const apiPrefix = config.get<string>('app.apiPrefix') ?? 'api/v1';
  const corsOrigins = config.get<string>('app.corsOrigins') ?? '*';
  const isProduction = config.get<string>('app.env') === 'production';

  // =========================
  // SECURITY & PERFORMANCE MIDDLEWARE
  // =========================
  // Allow the SPA (different origin in dev) to load uploaded images via <img>.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  // Concise, Apache-style access logs in production; verbose colored logs in dev.
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // Behind CloudPanel/NGINX: trust the proxy so client IPs / protocol are correct.
  app.set('trust proxy', 1);

  // Flush DB connections and in-flight work on SIGTERM/SIGINT (PM2 reloads).
  app.enableShutdownHooks();

  // =========================
  // STATIC UPLOADS  →  http://host/uploads/products/<file>
  // =========================
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  app.enableCors({
    origin:
      corsOrigins === '*' ? true : corsOrigins.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // =========================
  // GLOBAL API PREFIX
  // =========================
  app.setGlobalPrefix(apiPrefix);

  // =========================
  // GLOBAL VALIDATION
  // =========================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter + response/logging interceptors are registered in
  // AppModule via APP_FILTER / APP_INTERCEPTOR (DI-aware).

  // =========================
  // SWAGGER
  // =========================
  if (config.get<boolean>('swagger.enabled')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(config.get<string>('swagger.title') ?? 'API')
      .setDescription(config.get<string>('swagger.description') ?? '')
      .setVersion(config.get<string>('swagger.version') ?? '1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    const swaggerPath = config.get<string>('swagger.path') ?? 'docs';
    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`📄 Swagger docs: http://localhost:${port}/${swaggerPath}`);
  }

  // Bind to 0.0.0.0 so the reverse proxy (CloudPanel/NGINX) can reach the app.
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Server running on port ${port} (prefix /${apiPrefix})`);
}

void bootstrap();
