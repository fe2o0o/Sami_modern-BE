import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryWarehouseDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'تصفية حسب الفرع' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الفرع غير صحيح' })
  branchId?: string;

  @ApiPropertyOptional({ description: 'تصفية حسب حالة التفعيل' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
