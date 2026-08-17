import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Reverse a posted opening balance. Reason is mandatory. The reversal is posted
 * into the chosen open accounting period on the given date (validated server
 * side). `force` acknowledges warnings (e.g. negative stock) and requires the
 * force-reverse permission.
 */
export class ReverseOpeningBalanceDto {
  @ApiProperty({ example: 'تم إدخال أرصدة العملاء بشكل غير صحيح' })
  @IsString({ message: 'سبب العكس مطلوب' })
  @MinLength(3, { message: 'سبب العكس يجب ألا يقل عن 3 أحرف' })
  @MaxLength(500, { message: 'سبب العكس يجب ألا يتجاوز 500 حرف' })
  reason!: string;

  @ApiProperty({ example: '2026-07-25' })
  @IsDateString({}, { message: 'تاريخ العكس مطلوب' })
  reversalDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'الفترة المحاسبية للعكس مطلوبة' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'قيمة العكس الإجباري يجب أن تكون منطقية' })
  force?: boolean;
}
