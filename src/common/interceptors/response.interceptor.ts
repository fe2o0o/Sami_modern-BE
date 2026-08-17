import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../constants/app.constants';
import {
  ApiResponse,
  PaginatedResult,
} from '../interfaces/api-response.interface';

/**
 * Wraps every successful controller return value in the unified success
 * envelope. If a handler returns a { items, meta } shape, `meta` is lifted to
 * the top level and `data` becomes the items array.
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'Operation completed successfully';

    return next.handle().pipe(
      map((payload): ApiResponse<T> => {
        const isPaginated =
          payload !== null &&
          typeof payload === 'object' &&
          'items' in (payload as object) &&
          'meta' in (payload as object);

        const paginated = payload as unknown as PaginatedResult<unknown>;
        const data = isPaginated ? (paginated.items as unknown as T) : payload;

        return {
          success: true,
          statusCode: response.statusCode,
          message,
          data,
          ...(isPaginated ? { pagination: paginated.meta } : {}),
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      }),
    );
  }
}
