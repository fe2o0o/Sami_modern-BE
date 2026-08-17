import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { APP_CONSTANTS } from '../../../common/constants/app.constants';

/**
 * Filters for the General Ledger account view. Fiscal year and account are
 * required — the ledger is always "one account within a fiscal year".
 */
export class GeneralLedgerQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الحساب' })
  accountId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  accountingPeriodId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ default: APP_CONSTANTS.DEFAULT_PAGE, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = APP_CONSTANTS.DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: APP_CONSTANTS.DEFAULT_PER_PAGE,
    minimum: 1,
    maximum: APP_CONSTANTS.MAX_PER_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(APP_CONSTANTS.MAX_PER_PAGE)
  perPage: number = APP_CONSTANTS.DEFAULT_PER_PAGE;

  get skip(): number {
    return (this.page - 1) * this.perPage;
  }
}
