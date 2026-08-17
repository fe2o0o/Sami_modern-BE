import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { APP_CONSTANTS } from '../constants/app.constants';
import { Order } from '../enums/order.enum';

/**
 * Reusable pagination + sorting + search query parameters.
 * Extend this in feature-specific query DTOs.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: APP_CONSTANTS.DEFAULT_PAGE, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = APP_CONSTANTS.DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: APP_CONSTANTS.DEFAULT_PER_PAGE,
    minimum: 1,
    maximum: APP_CONSTANTS.MAX_PER_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(APP_CONSTANTS.MAX_PER_PAGE)
  perPage: number = APP_CONSTANTS.DEFAULT_PER_PAGE;

  @ApiPropertyOptional({ description: 'Free-text search term' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Column to sort by' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: Order, default: Order.DESC })
  @IsOptional()
  @IsEnum(Order)
  order: Order = Order.DESC;

  /** Zero-based offset derived from page/perPage — handy for queries. */
  get skip(): number {
    return (this.page - 1) * this.perPage;
  }
}
