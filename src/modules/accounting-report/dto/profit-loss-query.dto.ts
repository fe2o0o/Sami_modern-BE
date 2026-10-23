import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export const PROFIT_LOSS_COMPARE = ['none', 'previous', 'last_year'] as const;
export type ProfitLossCompare = (typeof PROFIT_LOSS_COMPARE)[number];

/** Profit & loss analysis for a date range (optionally one branch), with a comparison window. */
export class ProfitLossQueryDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  dateFrom!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  dateTo!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الفرع غير صحيح' })
  branchId?: string;

  /** previous = the same length right before · last_year = the same dates a year earlier. */
  @ApiPropertyOptional({ enum: PROFIT_LOSS_COMPARE, default: 'previous' })
  @IsOptional()
  @IsIn(PROFIT_LOSS_COMPARE as unknown as string[], { message: 'نوع المقارنة غير صحيح' })
  compare?: ProfitLossCompare;
}
