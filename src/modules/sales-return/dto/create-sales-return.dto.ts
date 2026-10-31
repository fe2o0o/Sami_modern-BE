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
import { ReturnManufacturingAction } from '../enums/sales-return.enum';

export class SalesReturnItemDto {
  @ApiProperty({ format: 'uuid', description: 'سطر الفاتورة الأصلية المُرتجَع منه' })
  @IsUUID('4', { message: 'سطر الفاتورة غير صحيح' })
  salesInvoiceItemId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  /** Manufacturing lines: the warehouse the delivered (manufactured) item goes back into. */
  @ApiPropertyOptional({ format: 'uuid', description: 'مخزن إرجاع الصنف المُصنّع (لسطور التصنيع المُسلَّمة)' })
  @IsOptional()
  @IsUUID('4', { message: 'مخزن الإرجاع غير صحيح' })
  warehouseId?: string | null;

  /** Manufacturing lines not delivered yet: stop the production order, or let it finish into stock. */
  @ApiPropertyOptional({ enum: ReturnManufacturingAction, description: 'صنف تصنيع لم يُسلَّم: إيقاف التصنيع أم استكماله واستلامه في المخزن' })
  @IsOptional()
  @IsEnum(ReturnManufacturingAction, { message: 'اختر: إيقاف التصنيع أو استكماله واستلامه في المخزن' })
  manufacturingAction?: ReturnManufacturingAction | null;
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
