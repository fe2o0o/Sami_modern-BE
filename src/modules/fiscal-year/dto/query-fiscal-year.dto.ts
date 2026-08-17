import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryFiscalYearDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'تصفية حسب السنة الحالية' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isCurrent?: boolean;

  @ApiPropertyOptional({ description: 'تصفية حسب حالة الإغلاق' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isClosed?: boolean;
}
