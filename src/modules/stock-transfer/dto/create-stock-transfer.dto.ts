import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class StockTransferItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج' })
  productId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreateStockTransferDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ التحويل غير صحيح' })
  transferDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المخزن المصدر' })
  fromWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المخزن الوجهة' })
  toWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [StockTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة صنف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items!: StockTransferItemDto[];
}
