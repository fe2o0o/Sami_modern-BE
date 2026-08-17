import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Reverse a POSTED manual journal entry. The reversal posts into the chosen
 * OPEN accounting period on `reversalDate` (never re-opening the original
 * period) as a new balanced entry with the opposite lines.
 */
export class ReverseJournalEntryDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'سبب العكس مطلوب (3 أحرف على الأقل)' })
  reason!: string;

  @ApiProperty({ format: 'date', example: '2026-07-25' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية للعكس' })
  accountingPeriodId!: string;
}
