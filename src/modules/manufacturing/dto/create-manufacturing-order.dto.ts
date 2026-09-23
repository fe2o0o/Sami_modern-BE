import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ManufacturingComponentDto } from './manufacturing-component.dto';

/**
 * Create a manufacturing (production) request. No components/costs — it captures
 * the customer's specification and tracks status. No stock/accounting effect.
 */
export class CreateManufacturingOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المنتج' })
  productId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الأمر غير صحيح' })
  orderDate!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ التسليم غير صحيح' })
  deliveryDate?: string | null;

  @ApiPropertyOptional({ description: 'المقاسات' })
  @IsOptional()
  @IsString()
  dimensions?: string | null;

  @ApiPropertyOptional({ description: 'اللون' })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiPropertyOptional({ description: 'الخامة' })
  @IsOptional()
  @IsString()
  material?: string | null;

  @ApiPropertyOptional({ description: 'مواصفات نصية حرة' })
  @IsOptional()
  @IsString()
  specifications?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fiscalYearId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ minimum: 0, description: 'رسوم التصنيع الافتراضية' })
  @IsOptional()
  @IsNumber({}, { message: 'رسوم التصنيع يجب أن تكون رقماً' })
  @Min(0, { message: 'رسوم التصنيع لا يمكن أن تكون سالبة' })
  manufacturingFee?: number | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'مصنع (مورّد) خارجي' })
  @IsOptional()
  @IsUUID()
  factorySupplierId?: string | null;

  /** BOM component lines (total quantity for the whole order). When omitted on a
   *  manual create, the product's default BOM is copied automatically. */
  @ApiPropertyOptional({ type: [ManufacturingComponentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManufacturingComponentDto)
  components?: ManufacturingComponentDto[];
}
