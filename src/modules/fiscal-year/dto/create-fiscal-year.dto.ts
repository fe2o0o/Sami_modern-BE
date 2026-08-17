import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateFiscalYearDto {
  @ApiProperty({ example: 'FY2026' })
  @IsString({ message: 'اسم السنة المالية مطلوب' })
  @MaxLength(100, { message: 'الاسم يجب ألا يتجاوز 100 حرف' })
  name!: string;

  @ApiProperty({ example: '2026' })
  @IsString({ message: 'الكود مطلوب' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString({}, { message: 'تاريخ البداية مطلوب' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString({}, { message: 'تاريخ النهاية مطلوب' })
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'إنشاء الفترات المحاسبية تلقائياً بناءً على نطاق تواريخ السنة المالية',
  })
  @IsOptional()
  @IsBoolean({ message: 'قيمة إنشاء الفترات المحاسبية يجب أن تكون منطقية' })
  generateAccountingPeriods?: boolean;
}
