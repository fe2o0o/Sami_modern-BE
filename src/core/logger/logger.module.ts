import { Global, Module } from '@nestjs/common';
import { AppLoggerService } from './app-logger.service';

/**
 * Global logger module — makes AppLoggerService injectable everywhere
 * without re-importing.
 */
@Global()
@Module({
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class LoggerModule {}
