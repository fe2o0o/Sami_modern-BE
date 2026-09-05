import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UserModule } from '../user/user.module';
import { CompanyModule } from '../company/company.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';

/**
 * Authentication module. Registers Passport + JWT, the JWT strategy, and the
 * global JwtAuthGuard so EVERY route is protected by default (@Public() opts
 * out). Access + refresh tokens are issued by AuthService.
 */
@Module({
  imports: [
    UserModule,
    CompanyModule,
    PermissionsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // jwt.secret is guaranteed present (see jwt.config: fails fast if unset).
        secret: config.get<string>('jwt.secret'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Order matters: authenticate first, then authorize. Both are global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
