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
import { SalesDeliverySource } from '../enums/sales-delivery.enum';

export class SalesDeliveryItemDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'سطر الفاتورة (مطلوب للتسليم من فاتورة)' })
  @IsOptional()
  @IsUUID('4', { message: 'سطر الفاتورة غير صحيح' })
  salesInvoiceItemId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'المنتج (مطلوب للتسليم المستقل)' })
  @IsOptional()
  @IsUUID('4', { message: 'المنتج غير صحيح' })
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  unitId?: string | null;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreateSalesDeliveryDto {
  @ApiProperty({ enum: SalesDeliverySource })
  @IsEnum(SalesDeliverySource, { message: 'مصدر إذن التسليم غير صحيح' })
  source!: SalesDeliverySource;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ التسليم غير صحيح' })
  deliveryDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'فاتورة المبيعات (مطلوبة عند المصدر = فاتورة)' })
  @IsOptional()
  @IsUUID('4', { message: 'الفاتورة غير صحيحة' })
  salesInvoiceId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'العميل (مطلوب للتسليم المستقل)' })
  @IsOptional()
  @IsUUID('4', { message: 'العميل غير صحيح' })
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'المخزن (مطلوب للتسليم المستقل)' })
  @IsOptional()
  @IsUUID('4', { message: 'المخزن غير صحيح' })
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [SalesDeliveryItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة صنف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => SalesDeliveryItemDto)
  items!: SalesDeliveryItemDto[];
}
