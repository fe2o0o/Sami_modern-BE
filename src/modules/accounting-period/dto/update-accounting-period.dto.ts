import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** A closed period cannot be edited (enforced in the service). */
export class UpdateAccountingPeriodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'اسم الفترة يجب أن يكون نصاً' })
  @MaxLength(100, { message: 'اسم الفترة يجب ألا يتجاوز 100 حرف' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;
}
