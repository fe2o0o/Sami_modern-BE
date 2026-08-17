import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Database module.
 *
 * TypeORM connection using the namespaced `database` config + snake_case naming
 * strategy. `synchronize` follows DB_SYNCHRONIZE (ON in dev, OFF for production
 * where migrations take over).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        autoLoadEntities: true,
        synchronize: config.get<boolean>('database.synchronize'),
        namingStrategy: new SnakeNamingStrategy(),
        logging: config.get<boolean>('database.logging'),
      }),
    }),
  ],
})
export class DatabaseModule {}
