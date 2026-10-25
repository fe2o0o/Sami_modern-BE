import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { SalesLineType } from '../../sales-invoice/enums/sales-invoice.enum';

export const DELIVERED_ITEMS_SORT = ['deliveryDate', 'quantity', 'salesValue', 'cost', 'grossProfit'] as const;
export type DeliveredItemsSort = (typeof DELIVERED_ITEMS_SORT)[number];

/** Filters for the line-by-line delivered products report. Dates = actual delivery date. */
export class DeliveredItemsQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'Default: first day of the current month' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Default: today' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الفرع غير صحيح' })
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'العميل غير صحيح' })
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Sales employee on the invoice' })
  @IsOptional()
  @IsUUID('4', { message: 'الموظف غير صحيح' })
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'المنتج غير صحيح' })
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Includes all subcategories' })
  @IsOptional()
  @IsUUID('4', { message: 'التصنيف غير صحيح' })
  categoryId?: string;

  @ApiPropertyOptional({ enum: SalesLineType })
  @IsOptional()
  @IsEnum(SalesLineType, { message: 'نوع البند غير صحيح' })
  lineType?: SalesLineType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Warehouse the goods left from' })
  @IsOptional()
  @IsUUID('4', { message: 'المخزن غير صحيح' })
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Factory of the manufacturing order' })
  @IsOptional()
  @IsUUID('4', { message: 'المصنع غير صحيح' })
  factorySupplierId?: string;

  /** Delivery / invoice / manufacturing-order number, customer, product name / code. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: DELIVERED_ITEMS_SORT, default: 'deliveryDate' })
  @IsOptional()
  @IsIn(DELIVERED_ITEMS_SORT as unknown as string[])
  sortBy: DeliveredItemsSort = 'deliveryDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  perPage: number = 100;
}
