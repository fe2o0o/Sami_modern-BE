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

export class SalesReturnItemDto {
  @ApiProperty({ format: 'uuid', description: 'سطر الفاتورة الأصلية المُرتجَع منه' })
  @IsUUID('4', { message: 'سطر الفاتورة غير صحيح' })
  salesInvoiceItemId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

/** Create a sales return against an original invoice (always starts DRAFT). */
export class CreateSalesReturnDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفاتورة الأصلية' })
  salesInvoiceId!: string;

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

  @ApiProperty({ type: [SalesReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة صنف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => SalesReturnItemDto)
  items!: SalesReturnItemDto[];
}
