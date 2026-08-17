import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** Range for the employee sales-commission report. */
export class CommissionReportQueryDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  dateFrom!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  dateTo!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
