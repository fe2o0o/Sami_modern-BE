import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

/**
 * Catches every unhandled exception and formats it into the unified error
 * envelope. Maps HttpException, TypeORM query failures and unknown errors to
 * appropriate status codes without leaking internals in production.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error, details } = this.normalize(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode: status,
      message,
      error,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    message: string;
    error: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return { status, message: res, error: exception.name };
      }

      const resObj = res as Record<string, unknown>;
      const rawMessage = resObj['message'] ?? exception.message;

      return {
        status,
        message: Array.isArray(rawMessage)
          ? (rawMessage as string[]).join(', ')
          : String(rawMessage),
        error: (resObj['error'] as string) ?? exception.name,
        details: Array.isArray(rawMessage) ? rawMessage : resObj['code'],
      };
    }

    if (exception instanceof QueryFailedError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Database request failed',
        error: 'QueryFailedError',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }
}
