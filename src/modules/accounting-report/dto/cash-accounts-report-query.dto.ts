import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Filters for the Treasury / Cash-accounts report. Both dates are optional; when
 * `fromDate` is omitted there is no opening balance (everything is in-range) and
 * when `toDate` is omitted the window runs to today. `branchId` narrows to one
 * branch; `branchScope` is the caller's access scope, injected by the service.
 */
export class CashAccountsReportQueryDto {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Internal: branch access scope injected by the service (not user input).
   *  `declare` = type-only, so ValidationPipe's forbidNonWhitelisted ignores it. */
  declare branchScope?: string[] | null;
}
