import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Stock balances query: pagination/search + optional warehouse and category (subtree) filters. */
export class StockQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'تصفية حسب المخزن' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المخزن غير صالح' })
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'تصفية حسب التصنيف — يشمل كل التصنيفات الفرعية تحته' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف التصنيف غير صالح' })
  categoryId?: string;
}
