import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Filters for the dashboard analytics endpoints. When no range is given the
 * service defaults to the current calendar month. `branchId` lets a user with
 * multi-branch access narrow to one branch (branch-restricted users are always
 * scoped to their own branches regardless of this field).
 */
export class DashboardQueryDto {
  @ApiPropertyOptional({ format: 'date', description: 'بداية الفترة (افتراضي: أول الشهر الحالي)' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ البداية غير صحيح' })
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date', description: 'نهاية الفترة (افتراضي: آخر الشهر الحالي)' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' })
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'تصفية على فرع محدد' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
