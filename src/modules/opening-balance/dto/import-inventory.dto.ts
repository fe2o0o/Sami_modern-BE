import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Header fields for the inventory opening-balance Excel import. Sent as
 * multipart form fields alongside the file, so values arrive as strings.
 */
export class ImportInventoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'السنة المالية مطلوبة' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'الفترة المحاسبية مطلوبة' })
  accountingPeriodId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString({}, { message: 'تاريخ الافتتاح مطلوب' })
  openingDate!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  autoBalance?: boolean;
}
