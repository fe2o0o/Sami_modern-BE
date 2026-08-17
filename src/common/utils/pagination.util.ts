import { PaginatedResult, PaginationMeta } from '../interfaces/api-response.interface';

/** Build pagination metadata from the raw totals. */
export function buildPaginationMeta(
  totalItems: number,
  page: number,
  perPage: number,
): PaginationMeta {
  const totalPages = perPage > 0 ? Math.ceil(totalItems / perPage) : 0;

  return {
    currentPage: page,
    perPage,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/** Wrap a page of items + totals into the standard paginated result. */
export function paginate<T>(
  items: T[],
  totalItems: number,
  page: number,
  perPage: number,
): PaginatedResult<T> {
  return { items, meta: buildPaginationMeta(totalItems, page, perPage) };
}
