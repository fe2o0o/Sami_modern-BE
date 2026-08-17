import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { JournalEntryLineDto } from './journal-entry-line.dto';

/**
 * Create a manual journal entry (always starts as DRAFT). The backend assigns
 * sourceType = MANUAL, computes the totals from the lines and generates the
 * entry number only when the entry is posted.
 */
export class CreateJournalEntryDto {
  @ApiProperty({ format: 'date', example: '2026-01-15' })
  @IsDateString({}, { message: 'تاريخ القيد غير صحيح' })
  entryDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ type: [JournalEntryLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إدخال بند واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines!: JournalEntryLineDto[];
}
