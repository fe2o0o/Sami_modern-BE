import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { OpeningBalanceDetailDto } from './opening-balance-detail.dto';

export class CreateOpeningBalanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'السنة المالية مطلوبة' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'الفترة المحاسبية مطلوبة' })
  accountingPeriodId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString({}, { message: 'تاريخ الافتتاح مطلوب' })
  openingDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional({ default: true, description: 'موازنة تلقائية بحساب حقوق الملكية' })
  @IsOptional()
  @IsBoolean({ message: 'قيمة الموازنة التلقائية يجب أن تكون منطقية' })
  autoBalance?: boolean;

  @ApiPropertyOptional({ type: [OpeningBalanceDetailDto] })
  @IsOptional()
  @IsArray({ message: 'البنود يجب أن تكون قائمة' })
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceDetailDto)
  details?: OpeningBalanceDetailDto[];
}
