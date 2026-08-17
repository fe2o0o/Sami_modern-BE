import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Reverse a POSTED voucher. Reverses the journal, the party subledger and the
 * treasury/bank subledger inside one transaction, into the chosen OPEN period.
 */
export class ReverseVoucherDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'سبب العكس مطلوب (3 أحرف على الأقل)' })
  reason!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية للعكس' })
  accountingPeriodId!: string;
}
