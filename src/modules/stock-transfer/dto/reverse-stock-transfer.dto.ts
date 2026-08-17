import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MinLength } from 'class-validator';

export class ReverseStockTransferDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'سبب العكس مطلوب (3 أحرف على الأقل)' })
  reason!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;
}
