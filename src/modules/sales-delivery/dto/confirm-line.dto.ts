import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** Confirm delivery of one order line (default quantity = the full remaining). */
export class ConfirmLineDto {
  @ApiProperty({ format: 'date', description: 'تاريخ التسليم الفعلي' })
  @IsDateString({}, { message: 'تاريخ التسليم الفعلي غير صحيح' })
  actualDeliveryDate!: string;

  @ApiPropertyOptional({ minimum: 0.0001, description: 'الكمية المُسلّمة (افتراضي: المتبقي كله)' })
  @IsOptional()
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity?: number;

  /**
   * Manufacturing line whose production order was cancelled or deleted: deliver
   * the finished product from this warehouse's stock instead (availability checked).
   */
  @ApiPropertyOptional({ format: 'uuid', description: 'التسليم من مخزون هذا المخزن بدلاً من أمر التصنيع' })
  @IsOptional()
  @IsUUID('4', { message: 'المخزن غير صحيح' })
  fromWarehouseId?: string;
}

/** Reverse a confirmed order line. */
export class ReverseLineDto {
  @ApiProperty({ format: 'date', description: 'تاريخ العكس' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;
}

/** Cancel the undelivered remainder of a manufacturing line (credited via a posted return). */
export class CancelLineDto {
  @ApiProperty({ format: 'date', description: 'تاريخ المردود (الإلغاء)' })
  @IsDateString({}, { message: 'تاريخ الإلغاء غير صحيح' })
  returnDate!: string;

  @ApiPropertyOptional({ description: 'سبب الإلغاء' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null;
}
