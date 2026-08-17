import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';

@Injectable()
export class AccountingPeriodService {
  constructor(
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
  ) {}

  /** All periods of a fiscal year, ordered by period number. */
  findByFiscalYear(fiscalYearId: string): Promise<AccountingPeriod[]> {
    return this.periodRepository.find({
      where: { fiscalYearId },
      order: { periodNumber: 'ASC' },
    });
  }

  async findOne(id: string): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOne({ where: { id } });
    if (!period) {
      throw new NotFoundException('لم يتم العثور على الفترة المحاسبية');
    }
    return period;
  }

  /** Edit is only allowed while the period is open. */
  async update(
    id: string,
    dto: UpdateAccountingPeriodDto,
    actorId?: string,
  ): Promise<AccountingPeriod> {
    const period = await this.findOne(id);
    if (period.isClosed) {
      throw new BadRequestException('لا يمكن تعديل فترة محاسبية مغلقة');
    }

    const startDate = dto.startDate ?? period.startDate;
    const endDate = dto.endDate ?? period.endDate;
    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    Object.assign(period, dto, { updatedBy: actorId ?? null });
    return this.periodRepository.save(period);
  }

  async close(id: string, actorId?: string): Promise<AccountingPeriod> {
    const period = await this.findOne(id);
    if (period.isClosed) {
      throw new BadRequestException('الفترة المحاسبية مغلقة بالفعل');
    }

    period.isClosed = true;
    period.closedAt = new Date();
    period.closedBy = actorId ?? null;
    return this.periodRepository.save(period);
  }

  async reopen(id: string, actorId?: string): Promise<AccountingPeriod> {
    const period = await this.findOne(id);
    if (!period.isClosed) {
      throw new BadRequestException('الفترة المحاسبية مفتوحة بالفعل');
    }

    period.isClosed = false;
    period.closedAt = null;
    period.closedBy = null;
    period.updatedBy = actorId ?? null;
    return this.periodRepository.save(period);
  }
}
