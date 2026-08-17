import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import {
  AdjustmentType,
  InventoryAdjustmentStatus,
} from './enums/inventory-adjustment.enum';
import { CreateInventoryAdjustmentDto, InventoryAdjustmentItemDto } from './dto/create-inventory-adjustment.dto';
import { UpdateInventoryAdjustmentDto } from './dto/update-inventory-adjustment.dto';
import { InventoryAdjustmentQueryDto } from './dto/inventory-adjustment-query.dto';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface InventoryAdjustmentListItem {
  id: string;
  adjustmentNumber: string | null;
  adjustmentDate: string;
  warehouseId: string;
  warehouseName: string | null;
  itemsCount: number;
  totalValue: number;
  status: InventoryAdjustmentStatus;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    @InjectRepository(InventoryAdjustment)
    private readonly repository: Repository<InventoryAdjustment>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateInventoryAdjustmentDto, actorId?: string): Promise<InventoryAdjustment> {
    await this.assertRefs(dto);
    const items = await this.buildItems(dto.items);
    const adjustment = this.repository.create({
      adjustmentNumber: null,
      adjustmentDate: dto.adjustmentDate,
      warehouseId: dto.warehouseId,
      branchId: dto.branchId ?? null,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      status: InventoryAdjustmentStatus.DRAFT,
      totalValue: this.netValue(items),
      notes: dto.notes ?? null,
      createdBy: actorId ?? null,
      items,
    });
    return this.repository.save(adjustment);
  }

  async update(id: string, dto: UpdateInventoryAdjustmentDto, actorId?: string): Promise<InventoryAdjustment> {
    const adjustment = await this.getEditableDraft(id);
    if (dto.adjustmentDate) adjustment.adjustmentDate = dto.adjustmentDate;
    if (dto.warehouseId) adjustment.warehouseId = dto.warehouseId;
    if (dto.branchId !== undefined) adjustment.branchId = dto.branchId ?? null;
    if (dto.fiscalYearId) adjustment.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) adjustment.accountingPeriodId = dto.accountingPeriodId;
    if (dto.notes !== undefined) adjustment.notes = dto.notes ?? null;
    await this.assertRefs({
      warehouseId: adjustment.warehouseId,
      fiscalYearId: adjustment.fiscalYearId,
      accountingPeriodId: adjustment.accountingPeriodId,
    });

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        await manager.delete(InventoryAdjustmentItem, { inventoryAdjustmentId: id });
        const items = await this.buildItems(dto.items);
        adjustment.items = items;
        adjustment.totalValue = this.netValue(items);
      }
      adjustment.updatedBy = actorId ?? null;
      return manager.getRepository(InventoryAdjustment).save(adjustment);
    });
  }

  async remove(id: string, actorId?: string): Promise<void> {
    await this.getEditableDraft(id);
    await this.repository.update(id, { deletedBy: actorId ?? null });
    await this.repository.softDelete(id);
  }

  async findAll(query: InventoryAdjustmentQueryDto): Promise<PaginatedResult<InventoryAdjustmentListItem>> {
    const qb = this.repository.createQueryBuilder('a').leftJoinAndSelect('a.items', 'items');
    if (query.search) qb.andWhere('a.adjustmentNumber LIKE :s', { s: `%${query.search}%` });
    if (query.warehouseId) qb.andWhere('a.warehouseId = :wh', { wh: query.warehouseId });
    if (query.fiscalYearId) qb.andWhere('a.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.status) qb.andWhere('a.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('a.adjustmentDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('a.adjustmentDate <= :dt', { dt: query.dateTo });
    qb.orderBy('a.adjustmentDate', 'DESC').addOrderBy('a.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const warehouseName = await this.nameMap(this.warehouseRepository, items.map((i) => i.warehouseId));
    const rows: InventoryAdjustmentListItem[] = items.map((a) => ({
      id: a.id,
      adjustmentNumber: a.adjustmentNumber,
      adjustmentDate: a.adjustmentDate,
      warehouseId: a.warehouseId,
      warehouseName: warehouseName.get(a.warehouseId) ?? null,
      itemsCount: a.items?.length ?? 0,
      totalValue: a.totalValue,
      status: a.status,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<InventoryAdjustment> {
    const adjustment = await this.repository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!adjustment) throw new NotFoundException('لم يتم العثور على تسوية المخزون');
    return adjustment;
  }

  async findOneDetailed(id: string): Promise<Record<string, unknown>> {
    const a = await this.findOne(id);
    const [warehouse, branch, fiscalYear, period, users] = await Promise.all([
      this.warehouseRepository.findOne({ where: { id: a.warehouseId } }),
      a.branchId ? this.branchRepository.findOne({ where: { id: a.branchId } }) : null,
      this.fiscalYearRepository.findOne({ where: { id: a.fiscalYearId } }),
      this.periodRepository.findOne({ where: { id: a.accountingPeriodId } }),
      this.userNames([a.createdBy, a.postedBy, a.reversedBy]),
    ]);
    return {
      ...a,
      warehouseName: warehouse?.name ?? null,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(a.createdBy ?? '') ?? null,
      postedByName: users.get(a.postedBy ?? '') ?? null,
      reversedByName: users.get(a.reversedBy ?? '') ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private netValue(items: InventoryAdjustmentItem[]): number {
    return round2(
      items.reduce(
        (s, i) => s + (i.adjustmentType === AdjustmentType.INCREASE ? i.lineValue : -i.lineValue),
        0,
      ),
    );
  }

  private async buildItems(dtos: InventoryAdjustmentItemDto[]): Promise<InventoryAdjustmentItem[]> {
    const productIds = [...new Set(dtos.map((d) => d.productId))];
    const products = await this.productRepository.find({ where: { id: In(productIds) } });
    const byId = new Map(products.map((p): [string, Product] => [p.id, p]));
    const unitIds = [...new Set(products.map((p) => p.unitId).filter((v): v is string => !!v))];
    const units = unitIds.length ? await this.unitRepository.find({ where: { id: In(unitIds) } }) : [];
    const unitById = new Map(units.map((u): [string, Unit] => [u.id, u]));

    return dtos.map((d, index) => {
      const p = byId.get(d.productId);
      if (!p) throw new BadRequestException('أحد المنتجات غير موجود');
      if (!p.trackInventory) throw new BadRequestException(`المنتج "${p.name}" ليس صنفاً مخزنياً`);
      const item = new InventoryAdjustmentItem();
      item.lineNumber = index + 1;
      item.productId = d.productId;
      item.productCode = p.code;
      item.productName = p.name;
      item.unitName = p.unitId ? unitById.get(p.unitId)?.name ?? null : null;
      item.adjustmentType = d.adjustmentType;
      item.quantity = d.quantity;
      item.unitCost = round2(d.unitCost ?? 0);
      item.lineValue = round2(d.quantity * (d.unitCost ?? 0));
      return item;
    });
  }

  private async getEditableDraft(id: string): Promise<InventoryAdjustment> {
    const a = await this.findOne(id);
    if (a.status !== InventoryAdjustmentStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف تسوية مُرحّلة — استخدم العكس');
    }
    return a;
  }

  private async assertRefs(dto: {
    warehouseId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
  }): Promise<void> {
    const warehouse = await this.warehouseRepository.findOne({ where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    const period = await this.periodRepository.findOne({ where: { id: dto.accountingPeriodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== dto.fiscalYearId) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
  }

  private async nameMap<T extends { id: string; name: string }>(
    repo: Repository<T>,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await repo.find({ where: { id: In(unique) } as never });
    return new Map(rows.map((r): [string, string] => [r.id, r.name]));
  }

  private async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await this.userRepository.find({ where: { id: In(unique) } });
    return new Map(users.map((u): [string, string] => [u.id, u.fullName]));
  }
}
