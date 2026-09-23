import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

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
}

/** Reverse a confirmed order line. */
export class ReverseLineDto {
  @ApiProperty({ format: 'date', description: 'تاريخ العكس' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;
}
