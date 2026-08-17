import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';

/**
 * Application logger.
 *
 * Thin wrapper over Nest's ConsoleLogger so the whole app depends on a single
 * injectable logger abstraction. Swap the transport here (e.g. to Winston/file)
 * without touching call sites.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService extends ConsoleLogger {
  /** Structured info log with an optional context payload. */
  logWith(message: string, meta?: Record<string, unknown>): void {
    this.log(meta ? `${message} ${JSON.stringify(meta)}` : message);
  }
}
