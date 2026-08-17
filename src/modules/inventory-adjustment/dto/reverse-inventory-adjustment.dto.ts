import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, IsUUID, MinLength } from 'class-validator';

export class ReverseInventoryAdjustmentDto {
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
