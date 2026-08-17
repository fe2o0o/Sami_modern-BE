import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * Logs each request's method, path, status code and duration once the handler
 * completes (or errors). Complements the morgan HTTP access log with
 * application-level timing.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { method, url } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`${method} ${url} ${response.statusCode} - ${ms}ms`);
        },
        error: (err: { status?: number }) => {
          const ms = Date.now() - start;
          this.logger.error(
            `${method} ${url} ${err?.status ?? 500} - ${ms}ms`,
          );
        },
      }),
    );
  }
}
