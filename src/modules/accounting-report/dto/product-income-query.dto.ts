import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const PRODUCT_INCOME_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'last_year',
  'fiscal_year',
  'accounting_period',
  'custom',
] as const;
export type ProductIncomePreset = (typeof PRODUCT_INCOME_PRESETS)[number];

export const PRODUCT_INCOME_SORT = [
  'netRevenue',
  'grossRevenue',
  'quantitySold',
  'grossProfit',
  'grossMargin',
  'returns',
  'quantityReturned',
] as const;
export type ProductIncomeSort = (typeof PRODUCT_INCOME_SORT)[number];

export const PRODUCT_INCOME_COMPARE = ['previous', 'month', 'year'] as const;
export type ProductIncomeCompare = (typeof PRODUCT_INCOME_COMPARE)[number];

/** Filters for the product income summary. Dates are normalised server-side. */
export class ProductIncomeQueryDto {
  /** Named period; `custom` (or omitted with from/to) uses from/to. Default: this_month. */
  @ApiPropertyOptional({ enum: PRODUCT_INCOME_PRESETS })
  @IsOptional()
  @IsIn(PRODUCT_INCOME_PRESETS)
  preset?: ProductIncomePreset;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Product code / name search. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  perPage: number = 20;

  @ApiPropertyOptional({ enum: PRODUCT_INCOME_SORT, default: 'netRevenue' })
  @IsOptional()
  @IsIn(PRODUCT_INCOME_SORT)
  sortBy: ProductIncomeSort = 'netRevenue';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  /** Compare the summary with another period. */
  @ApiPropertyOptional({ enum: PRODUCT_INCOME_COMPARE })
  @IsOptional()
  @IsIn(PRODUCT_INCOME_COMPARE)
  compare?: ProductIncomeCompare;
}
