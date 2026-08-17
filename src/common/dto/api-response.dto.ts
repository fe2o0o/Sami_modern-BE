import { ApiProperty } from '@nestjs/swagger';
import { PaginationMeta } from '../interfaces/api-response.interface';

/**
 * Swagger documentation model for the unified success envelope.
 * `T` is documented per-endpoint via getSchemaPath in a custom decorator.
 */
export class ApiResponseDto<T = unknown> {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'Operation completed successfully' })
  message!: string;

  @ApiProperty()
  data!: T;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/resource' })
  path!: string;
}

export class PaginationMetaDto implements PaginationMeta {
  @ApiProperty({ example: 1 })
  currentPage!: number;

  @ApiProperty({ example: 10 })
  perPage!: number;

  @ApiProperty({ example: 100 })
  totalItems!: number;

  @ApiProperty({ example: 10 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage!: boolean;
}
