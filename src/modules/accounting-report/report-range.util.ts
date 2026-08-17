import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';

export interface ReportRange {
  from: string;
  to: string;
  fiscalYear: FiscalYear;
}

/**
 * Resolve the effective [from, to] date window shared by every accounting
 * report. Precedence: explicit fromDate/toDate → selected accounting period →
 * the whole fiscal year. Validates the period belongs to the fiscal year and
 * that the window is not inverted.
 */
export async function resolveReportRange(
  fiscalYearRepo: Repository<FiscalYear>,
  periodRepo: Repository<AccountingPeriod>,
  query: {
    fiscalYearId: string;
    accountingPeriodId?: string;
    fromDate?: string;
    toDate?: string;
  },
): Promise<ReportRange> {
  const fiscalYear = await fiscalYearRepo.findOne({
    where: { id: query.fiscalYearId },
  });
  if (!fiscalYear) {
    throw new NotFoundException('السنة المالية غير موجودة');
  }

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (query.accountingPeriodId) {
    const period = await periodRepo.findOne({
      where: { id: query.accountingPeriodId },
    });
    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة');
    }
    if (period.fiscalYearId !== fiscalYear.id) {
      throw new BadRequestException(
        'الفترة المحاسبية لا تتبع السنة المالية المختارة',
      );
    }
    periodStart = period.startDate;
    periodEnd = period.endDate;
  }

  const from = query.fromDate ?? periodStart ?? fiscalYear.startDate;
  const to = query.toDate ?? periodEnd ?? fiscalYear.endDate;

  if (new Date(from).getTime() > new Date(to).getTime()) {
    throw new BadRequestException('تاريخ البداية يجب أن يسبق تاريخ النهاية');
  }
  return { from, to, fiscalYear };
}
