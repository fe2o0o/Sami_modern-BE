/** Unified success envelope returned by the ResponseInterceptor. */
export interface ApiResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  pagination?: PaginationMeta;
  timestamp: string;
  path: string;
}

/** Unified error envelope returned by the global exception filter. */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

export interface PaginationMeta {
  currentPage: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Shape a service returns when it wants to attach pagination meta. */
export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}
