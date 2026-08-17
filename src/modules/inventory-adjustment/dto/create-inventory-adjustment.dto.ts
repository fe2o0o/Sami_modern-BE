import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdjustmentType } from '../enums/inventory-adjustment.enum';

export class InventoryAdjustmentItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج' })
  productId!: string;

  @ApiProperty({ enum: AdjustmentType })
  @IsEnum(AdjustmentType, { message: 'نوع التسوية غير صحيح' })
  adjustmentType!: AdjustmentType;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiPropertyOptional({ default: 0, description: 'تكلفة الوحدة (لتسوية الزيادة)' })
  @IsOptional()
  @IsNumber({}, { message: 'التكلفة يجب أن تكون رقماً' })
  @Min(0)
  unitCost?: number;
}

export class CreateInventoryAdjustmentDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ التسوية غير صحيح' })
  adjustmentDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المخزن' })
  warehouseId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [InventoryAdjustmentItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة صنف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentItemDto)
  items!: InventoryAdjustmentItemDto[];
}
