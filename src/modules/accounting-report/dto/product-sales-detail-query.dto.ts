import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { SalesLineType } from '../../sales-invoice/enums/sales-invoice.enum';

export const PRODUCT_SALES_DETAIL_SORT = ['invoiceDate', 'netRevenue', 'cost', 'grossProfit', 'grossMargin', 'quantity'] as const;
export type ProductSalesDetailSort = (typeof PRODUCT_SALES_DETAIL_SORT)[number];

/** Filters for the line-by-line product sales (income) detail. */
export class ProductSalesDetailQueryDto {
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

  @ApiPropertyOptional({ format: 'uuid', description: 'Sales employee (commission line)' })
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

  @ApiPropertyOptional({ format: 'uuid', description: 'Factory (manufacturing lines)' })
  @IsOptional()
  @IsUUID('4', { message: 'المصنع غير صحيح' })
  factorySupplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'المخزن غير صحيح' })
  warehouseId?: string;

  /** Invoice number, customer, product name / code. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: PRODUCT_SALES_DETAIL_SORT, default: 'invoiceDate' })
  @IsOptional()
  @IsIn(PRODUCT_SALES_DETAIL_SORT as unknown as string[])
  sortBy: ProductSalesDetailSort = 'invoiceDate';

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
