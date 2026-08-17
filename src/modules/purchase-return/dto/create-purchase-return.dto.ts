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

export class PurchaseReturnItemDto {
  @ApiProperty({ format: 'uuid', description: 'سطر فاتورة المشتريات المُرتجَع منه' })
  @IsUUID('4', { message: 'سطر الفاتورة غير صحيح' })
  purchaseInvoiceItemId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreatePurchaseReturnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار فاتورة المشتريات الأصلية' })
  purchaseInvoiceId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ المردود غير صحيح' })
  returnDate!: string;

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

  @ApiProperty({ type: [PurchaseReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة صنف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items!: PurchaseReturnItemDto[];
}
