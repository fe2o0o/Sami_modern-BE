import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Stock balances query: pagination/search + an optional warehouse filter. */
export class StockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'تصفية حسب المخزن' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المخزن غير صالح' })
  warehouseId?: string;
}
