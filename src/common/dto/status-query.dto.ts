import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

/**
 * Pagination + search + an `isActive` status filter. Reused by every flat
 * master-data list endpoint (units, brands, customers, suppliers, …).
 */
export class StatusQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'تصفية حسب حالة التفعيل' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
