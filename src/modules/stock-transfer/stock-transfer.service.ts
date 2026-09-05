import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { StockTransfer } from './entities/stock-transfer.entity';
import { StockTransferItem } from './entities/stock-transfer-item.entity';
import { StockTransferStatus } from './enums/stock-transfer.enum';
import { CreateStockTransferDto, StockTransferItemDto } from './dto/create-stock-transfer.dto';
import { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import { StockTransferQueryDto } from './dto/stock-transfer-query.dto';
import { ReverseStockTransferDto } from './dto/reverse-stock-transfer.dto';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { User } from '../user/entities/user.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface StockTransferListItem {
  id: string;
  transferNumber: string | null;
  transferDate: string;
  fromWarehouseId: string;
  fromWarehouseName: string | null;
  toWarehouseId: string;
  toWarehouseName: string | null;
  itemsCount: number;
  totalValue: number;
  status: StockTransferStatus;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class StockTransferService {
  constructor(
    @InjectRepository(StockTransfer)
    private readonly repository: Repository<StockTransfer>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // CREATE / UPDATE / DELETE (DRAFT)
  // =========================================================
  async create(
    dto: CreateStockTransferDto,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<StockTransfer> {
    await this.assertRefs(dto);
    const transfer = this.repository.create({
      transferNumber: null,
      transferDate: dto.transferDate,
      fromWarehouseId: dto.fromWarehouseId,
      toWarehouseId: dto.toWarehouseId,
      fiscalYearId: dto.fiscalYearId,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: branchScope ?? dto.branchId ?? null,
      status: StockTransferStatus.DRAFT,
      notes: dto.notes ?? null,
      createdBy: actorId ?? null,
      items: await this.buildItems(dto.items),
    });
    return this.repository.save(transfer);
  }

  async update(
    id: string,
    dto: UpdateStockTransferDto,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<StockTransfer> {
    const transfer = await this.getEditableDraft(id, branchScope);
    if (dto.transferDate) transfer.transferDate = dto.transferDate;
    if (dto.fromWarehouseId) transfer.fromWarehouseId = dto.fromWarehouseId;
    if (dto.toWarehouseId) transfer.toWarehouseId = dto.toWarehouseId;
    if (dto.fiscalYearId) transfer.fiscalYearId = dto.fiscalYearId;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope) transfer.branchId = branchScope;
    else if (dto.branchId !== undefined) transfer.branchId = dto.branchId ?? null;
    if (dto.notes !== undefined) transfer.notes = dto.notes ?? null;
    await this.assertRefs({ fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId });

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        await manager.delete(StockTransferItem, { stockTransferId: id });
        transfer.items = await this.buildItems(dto.items);
      }
      transfer.updatedBy = actorId ?? null;
      return manager.getRepository(StockTransfer).save(transfer);
    });
  }

  async remove(
    id: string,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.repository.update(id, { deletedBy: actorId ?? null });
    await this.repository.softDelete(id);
  }

  // =========================================================
  // POST / REVERSE
  // =========================================================
  async post(id: string, actorId?: string, branchScope: string | null = null): Promise<StockTransfer> {
    return this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id);
      if (branchScope && transfer.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على التحويل');
      }
      if (transfer.status !== StockTransferStatus.DRAFT) {
        throw new BadRequestException('لا يمكن ترحيل تحويل غير مسودة');
      }
      if (!transfer.items?.length) throw new BadRequestException('لا يمكن ترحيل تحويل بدون أصناف');
      if (transfer.fromWarehouseId === transfer.toWarehouseId) {
        throw new BadRequestException('المخزن المصدر والوجهة لا يمكن أن يكونا نفس المخزن');
      }

      const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: transfer.fiscalYearId } });
      if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
      const number = await this.sequenceService.nextDocumentNumber('TRF', fiscalYear, manager);

      let totalValue = 0;
      for (const item of transfer.items) {
        // Issue from source (locked, availability-checked) at its avg cost.
        const issued = await this.stockService.issue(
          [{
            warehouseId: transfer.fromWarehouseId,
            productId: item.productId,
            productName: item.productName ?? undefined,
            quantity: item.quantity,
          }],
          manager,
          this.opts(number, transfer, actorId, StockMovementType.TRANSFER),
        );
        const unitCost = issued[0].unitCost;
        item.unitCost = unitCost;
        totalValue = round2(totalValue + issued[0].totalCost);
        // Receive into destination at the same cost.
        await this.stockService.receive(
          [{ warehouseId: transfer.toWarehouseId, productId: item.productId, quantity: item.quantity, unitCost }],
          manager,
          this.opts(number, transfer, actorId, StockMovementType.TRANSFER),
        );
      }

      transfer.transferNumber = number;
      transfer.status = StockTransferStatus.POSTED;
      transfer.totalValue = totalValue;
      transfer.postedAt = new Date();
      transfer.postedBy = actorId ?? null;
      transfer.updatedBy = actorId ?? null;

      await manager.getRepository(StockTransfer).save(transfer);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReverseStockTransferDto, actorId?: string, branchScope: string | null = null): Promise<StockTransfer> {
    return this.dataSource.transaction(async (manager) => {
      const transfer = await this.lock(manager, id);
      if (branchScope && transfer.branchId !== branchScope) {
        throw new NotFoundException('لم يتم العثور على التحويل');
      }
      if (transfer.status === StockTransferStatus.REVERSED) {
        throw new ConflictException('التحويل معكوس بالفعل');
      }
      if (transfer.status !== StockTransferStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس تحويل غير مُرحّل');
      }
      for (const item of transfer.items) {
        // Take back from destination (may go negative) and return to source.
        await this.stockService.issue(
          [{ warehouseId: transfer.toWarehouseId, productId: item.productId, quantity: item.quantity }],
          manager,
          { ...this.opts(transfer.transferNumber, transfer, actorId, StockMovementType.TRANSFER, dto.reversalDate), allowNegative: true },
        );
        await this.stockService.receive(
          [{ warehouseId: transfer.fromWarehouseId, productId: item.productId, quantity: item.quantity, unitCost: item.unitCost }],
          manager,
          this.opts(transfer.transferNumber, transfer, actorId, StockMovementType.TRANSFER, dto.reversalDate),
        );
      }

      transfer.status = StockTransferStatus.REVERSED;
      transfer.reversedAt = new Date();
      transfer.reversedBy = actorId ?? null;
      transfer.reversalReason = dto.reason;
      transfer.updatedBy = actorId ?? null;

      await manager.getRepository(StockTransfer).save(transfer);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: StockTransferQueryDto,
    branchScope: string | null = null,
  ): Promise<PaginatedResult<StockTransferListItem>> {
    const qb = this.repository.createQueryBuilder('t').leftJoinAndSelect('t.items', 'items');
    // Branch-restricted users only ever see their own branch's documents.
    if (branchScope) qb.andWhere('t.branchId = :branchScope', { branchScope });
    if (query.search) qb.andWhere('t.transferNumber LIKE :s', { s: `%${query.search}%` });
    if (query.warehouseId) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('t.fromWarehouseId = :wid', { wid: query.warehouseId }).orWhere('t.toWarehouseId = :wid', {
            wid: query.warehouseId,
          });
        }),
      );
    }
    if (query.fiscalYearId) qb.andWhere('t.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.status) qb.andWhere('t.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('t.transferDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('t.transferDate <= :dt', { dt: query.dateTo });
    qb.orderBy('t.transferDate', 'DESC').addOrderBy('t.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const names = await this.nameMap(
      this.warehouseRepository,
      items.flatMap((t) => [t.fromWarehouseId, t.toWarehouseId]),
    );
    const rows: StockTransferListItem[] = items.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      transferDate: t.transferDate,
      fromWarehouseId: t.fromWarehouseId,
      fromWarehouseName: names.get(t.fromWarehouseId) ?? null,
      toWarehouseId: t.toWarehouseId,
      toWarehouseName: names.get(t.toWarehouseId) ?? null,
      itemsCount: t.items?.length ?? 0,
      totalValue: t.totalValue,
      status: t.status,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: string | null = null): Promise<StockTransfer> {
    const transfer = await this.repository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!transfer || (branchScope && transfer.branchId !== branchScope)) {
      throw new NotFoundException('لم يتم العثور على التحويل');
    }
    return transfer;
  }

  async findOneDetailed(id: string, branchScope: string | null = null): Promise<Record<string, unknown>> {
    const t = await this.findOne(id, branchScope);
    const [names, fiscalYear, users] = await Promise.all([
      this.nameMap(this.warehouseRepository, [t.fromWarehouseId, t.toWarehouseId]),
      this.fiscalYearRepository.findOne({ where: { id: t.fiscalYearId } }),
      this.userNames([t.createdBy, t.postedBy, t.reversedBy]),
    ]);
    return {
      ...t,
      fromWarehouseName: names.get(t.fromWarehouseId) ?? null,
      toWarehouseName: names.get(t.toWarehouseId) ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      createdByName: users.get(t.createdBy ?? '') ?? null,
      postedByName: users.get(t.postedBy ?? '') ?? null,
      reversedByName: users.get(t.reversedBy ?? '') ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private opts(
    number: string | null,
    transfer: StockTransfer,
    actorId: string | undefined,
    movementType: StockMovementType,
    date?: string,
  ) {
    return {
      movementType,
      sourceType: 'stock_transfer',
      sourceId: transfer.id,
      sourceNumber: number,
      movementDate: date ?? transfer.transferDate,
      actorId,
    };
  }

  private async buildItems(dtos: StockTransferItemDto[]): Promise<StockTransferItem[]> {
    const ids = [...new Set(dtos.map((d) => d.productId))];
    const products = await this.productRepository.find({ where: { id: In(ids) } });
    const byId = new Map(products.map((p): [string, Product] => [p.id, p]));
    const unitIds = [...new Set(products.map((p) => p.unitId).filter((v): v is string => !!v))];
    const units = unitIds.length ? await this.unitRepository.find({ where: { id: In(unitIds) } }) : [];
    const unitById = new Map(units.map((u): [string, Unit] => [u.id, u]));
    return dtos.map((d, index) => {
      const p = byId.get(d.productId);
      if (!p) throw new BadRequestException('أحد المنتجات غير موجود');
      if (!p.trackInventory) throw new BadRequestException(`المنتج "${p.name}" ليس صنفاً مخزنياً`);
      const item = new StockTransferItem();
      item.lineNumber = index + 1;
      item.productId = d.productId;
      item.productCode = p.code;
      item.productName = p.name;
      item.unitName = p.unitId ? unitById.get(p.unitId)?.name ?? null : null;
      item.quantity = d.quantity;
      item.unitCost = 0;
      return item;
    });
  }

  private async getEditableDraft(id: string, branchScope: string | null = null): Promise<StockTransfer> {
    const t = await this.findOne(id, branchScope);
    if (t.status !== StockTransferStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف تحويل مُرحّل — استخدم العكس');
    }
    return t;
  }

  private async assertRefs(dto: { fromWarehouseId: string; toWarehouseId: string }): Promise<void> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('المخزن المصدر والوجهة لا يمكن أن يكونا نفس المخزن');
    }
    const count = await this.warehouseRepository.count({ where: { id: In([dto.fromWarehouseId, dto.toWarehouseId]) } });
    if (count < 2) throw new NotFoundException('أحد المخازن غير موجود');
  }

  private async lock(manager: EntityManager, id: string): Promise<StockTransfer> {
    const t = await manager.findOne(StockTransfer, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!t) throw new NotFoundException('لم يتم العثور على التحويل');
    return t;
  }

  private reload(manager: EntityManager, id: string): Promise<StockTransfer> {
    return manager.findOne(StockTransfer, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<StockTransfer>;
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
