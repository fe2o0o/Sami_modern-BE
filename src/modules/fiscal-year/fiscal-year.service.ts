import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { FiscalYear } from './entities/fiscal-year.entity';
import { Role } from '../role/entities/role.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { AccountingPeriodGeneratorService } from '../accounting-period/services/accounting-period-generator.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { UpdateFiscalYearDto } from './dto/update-fiscal-year.dto';
import { QueryFiscalYearDto } from './dto/query-fiscal-year.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';

/** Fiscal year enriched with its accounting-period counters. */
export interface FiscalYearWithStats extends FiscalYear {
  stats: {
    totalPeriods: number;
    closedPeriods: number;
    openPeriods: number;
  };
}

@Injectable()
export class FiscalYearService {
  constructor(
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    private readonly periodGenerator: AccountingPeriodGeneratorService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================
  // CREATE (+ optional period generation, all in one transaction)
  // =========================
  async create(
    dto: CreateFiscalYearDto,
    actorId?: string,
  ): Promise<FiscalYear & { generatedPeriods: number }> {
    this.validateDateRange(dto.startDate, dto.endDate);
    await this.ensureCodeUnique(dto.code);
    await this.ensureNoOverlap(dto.startDate, dto.endDate);

    const { generateAccountingPeriods = true, ...payload } = dto;

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FiscalYear);
      const fiscalYear = await repo.save(
        repo.create({ ...payload, createdBy: actorId ?? null }),
      );

      let generatedPeriods = 0;
      if (generateAccountingPeriods) {
        const periods = await this.periodGenerator.generateForFiscalYear(
          fiscalYear,
          manager,
          actorId,
        );
        generatedPeriods = periods.length;
      }

      return Object.assign(fiscalYear, { generatedPeriods });
    });
  }

  // =========================
  // GENERATE PERIODS (manual, for a year that has none)
  // =========================
  async generatePeriods(
    id: string,
    actorId?: string,
  ): Promise<{ generatedPeriods: number }> {
    const fiscalYear = await this.getEntity(id);

    const existing = await this.periodRepository.count({
      where: { fiscalYearId: id },
    });
    if (existing > 0) {
      throw new ConflictException('لا يمكن إنشاء الفترات المحاسبية لأنها موجودة بالفعل');
    }

    return this.dataSource.transaction(async (manager) => {
      const periods = await this.periodGenerator.generateForFiscalYear(
        fiscalYear,
        manager,
        actorId,
      );
      return { generatedPeriods: periods.length };
    });
  }

  // =========================
  // LIST
  // =========================
  async findAll(query: QueryFiscalYearDto): Promise<PaginatedResult<FiscalYear>> {
    const qb = this.fiscalYearRepository.createQueryBuilder('fy');

    if (query.search) {
      qb.andWhere('(fy.name LIKE :s OR fy.code LIKE :s)', { s: `%${query.search}%` });
    }
    if (query.isCurrent !== undefined) {
      qb.andWhere('fy.isCurrent = :cur', { cur: query.isCurrent });
    }
    if (query.isClosed !== undefined) {
      qb.andWhere('fy.isClosed = :closed', { closed: query.isClosed });
    }

    const sortBy = query.sortBy ?? 'startDate';
    qb.orderBy(`fy.${sortBy}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  /** Detail view: the fiscal year plus its accounting-period counters. */
  async findOne(id: string): Promise<FiscalYearWithStats> {
    const fiscalYear = await this.getEntity(id);
    const [totalPeriods, closedPeriods] = await Promise.all([
      this.periodRepository.count({ where: { fiscalYearId: id } }),
      this.periodRepository.count({ where: { fiscalYearId: id, isClosed: true } }),
    ]);

    return Object.assign(fiscalYear, {
      stats: {
        totalPeriods,
        closedPeriods,
        openPeriods: totalPeriods - closedPeriods,
      },
    });
  }

  async findCurrent(): Promise<FiscalYear | null> {
    return this.fiscalYearRepository.findOne({ where: { isCurrent: true } });
  }

  async lookup(): Promise<{ id: string; name: string }[]> {
    const rows = await this.fiscalYearRepository.find({
      select: { id: true, name: true },
      order: { startDate: 'DESC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  // =========================
  // UPDATE (only when open)
  // =========================
  async update(
    id: string,
    dto: UpdateFiscalYearDto,
    actorId?: string,
  ): Promise<FiscalYear> {
    const fiscalYear = await this.getEntity(id);
    if (fiscalYear.isClosed) {
      throw new BadRequestException('لا يمكن تعديل سنة مالية مغلقة');
    }

    const startDate = dto.startDate ?? fiscalYear.startDate;
    const endDate = dto.endDate ?? fiscalYear.endDate;
    this.validateDateRange(startDate, endDate);

    if (dto.code && dto.code !== fiscalYear.code) {
      await this.ensureCodeUnique(dto.code, id);
    }
    if (dto.startDate || dto.endDate) {
      await this.ensureNoOverlap(startDate, endDate, id);
    }

    // `generateAccountingPeriods` is a create-time flag, not a column.
    const { generateAccountingPeriods: _flag, ...payload } = dto;
    Object.assign(fiscalYear, payload, { updatedBy: actorId ?? null });
    return this.fiscalYearRepository.save(fiscalYear);
  }

  // =========================
  // DELETE (soft, only if unused & open)
  // =========================
  async remove(id: string, actorId?: string): Promise<void> {
    const fiscalYear = await this.getEntity(id);
    if (fiscalYear.isClosed) {
      throw new BadRequestException('لا يمكن حذف سنة مالية مغلقة');
    }
    if (await this.hasTransactions(id)) {
      throw new BadRequestException('لا يمكن حذف سنة مالية مستخدمة');
    }
    await this.fiscalYearRepository.update(id, { deletedBy: actorId ?? null });
    await this.fiscalYearRepository.softDelete(id);
  }

  // =========================
  // SET CURRENT (transaction)
  // =========================
  async setCurrent(id: string): Promise<FiscalYear> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FiscalYear);
      const fiscalYear = await repo.findOne({ where: { id } });
      if (!fiscalYear) {
        throw new NotFoundException('لم يتم العثور على السنة المالية');
      }
      if (fiscalYear.isClosed) {
        throw new BadRequestException('لا يمكن تعيين سنة مالية مغلقة كحالية');
      }

      // Demote every other current year, then promote this one.
      await repo.update({ isCurrent: true, id: Not(id) }, { isCurrent: false });
      fiscalYear.isCurrent = true;
      return repo.save(fiscalYear);
    });
  }

  // =========================
  // CLOSE
  // =========================
  async close(id: string, actorId?: string): Promise<FiscalYear> {
    const fiscalYear = await this.getEntity(id);
    if (fiscalYear.isClosed) {
      throw new BadRequestException('السنة المالية مغلقة بالفعل');
    }

    // A fiscal year can only close once every accounting period is closed.
    const openPeriods = await this.periodRepository.count({
      where: { fiscalYearId: id, isClosed: false },
    });
    if (openPeriods > 0) {
      throw new BadRequestException(
        'لا يمكن إغلاق السنة المالية قبل إغلاق جميع الفترات المحاسبية',
      );
    }

    // Future: no draft journal entries / no pending documents.
    fiscalYear.isClosed = true;
    fiscalYear.closedAt = new Date();
    fiscalYear.closedBy = actorId ?? null;
    return this.fiscalYearRepository.save(fiscalYear);
  }

  // =========================
  // REOPEN (admin only)
  // =========================
  async reopen(id: string, actorRoleId: string): Promise<FiscalYear> {
    await this.ensureAdmin(actorRoleId);
    const fiscalYear = await this.getEntity(id);
    if (!fiscalYear.isClosed) {
      throw new BadRequestException('السنة المالية مفتوحة بالفعل');
    }

    fiscalYear.isClosed = false;
    fiscalYear.closedAt = null;
    fiscalYear.closedBy = null;
    return this.fiscalYearRepository.save(fiscalYear);
  }

  // =========================================================
  // PRIVATE
  // =========================================================

  private async getEntity(id: string): Promise<FiscalYear> {
    const fiscalYear = await this.fiscalYearRepository.findOne({ where: { id } });
    if (!fiscalYear) {
      throw new NotFoundException('لم يتم العثور على السنة المالية');
    }
    return fiscalYear;
  }

  private validateDateRange(startDate: string, endDate: string): void {
    if (new Date(startDate).getTime() >= new Date(endDate).getTime()) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.fiscalYearRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('الكود مستخدم بالفعل');
    }
  }

  /** Reject any fiscal year whose range intersects [startDate, endDate]. */
  private async ensureNoOverlap(
    startDate: string,
    endDate: string,
    ignoreId?: string,
  ): Promise<void> {
    const qb = this.fiscalYearRepository
      .createQueryBuilder('fy')
      .where('fy.startDate <= :endDate AND fy.endDate >= :startDate', {
        startDate,
        endDate,
      });
    if (ignoreId) {
      qb.andWhere('fy.id != :id', { id: ignoreId });
    }
    if (await qb.getCount()) {
      throw new ConflictException('توجد سنة مالية تتداخل مع هذه الفترة');
    }
  }

  private async ensureAdmin(roleId: string): Promise<void> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role || role.code !== 'ADMIN') {
      throw new ForbiddenException('هذه العملية متاحة لمدير النظام فقط');
    }
  }

  /**
   * Placeholder hook — always false until transactional modules exist
   * (invoices, purchases, journal entries, inventory, vouchers).
   */
  private async hasTransactions(_fiscalYearId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
