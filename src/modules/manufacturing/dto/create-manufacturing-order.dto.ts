import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

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
}
