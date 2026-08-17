import { ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Update a draft opening balance. `details`, when provided, fully replaces the
 * existing lines (the editable grid always sends the complete set).
 */
export class UpdateOpeningBalanceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الفترة المحاسبية غير صالحة' })
  accountingPeriodId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ الافتتاح غير صالح' })
  openingDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional({ default: true })
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
