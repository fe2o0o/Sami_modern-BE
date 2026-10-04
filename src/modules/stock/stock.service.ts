import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { EntityManager, Repository } from 'typeorm';
import { WarehouseStock } from './entities/warehouse-stock.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { StockDirection, StockMovementType } from './enums/stock.enum';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';

/** One opening stock line to apply. */
export interface OpeningStockItem {
  warehouseId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  notes?: string | null;
}

export interface ApplyOpeningOptions {
  movementDate: string;
  sourceId: string;
  actorId?: string | null;
}

/** A line to issue (OUT) or receive (IN) through the generic stock methods. */
export interface StockLineInput {
  warehouseId: string;
  productId: string;
  /** Only used for the oversell error message. */
  productName?: string;
  quantity: number;
  /** Required for `receive` (the incoming cost). Ignored by `issue`. */
  unitCost?: number;
}

export interface IssueOptions {
  movementType: StockMovementType;
  sourceType: string;
  sourceId: string;
  sourceNumber?: string | null;
  movementDate: string;
  actorId?: string | null;
  /** Allow the balance to go negative (reversal into an emptied warehouse). */
  allowNegative?: boolean;
  /**
   * Only FREE stock may be issued: quantity − reservedQuantity. Use for moves
   * that must not consume goods already promised to posted, undelivered sales
   * invoices (transfers, standalone delivery notes, manufacturing components).
   * Invoice-linked deliveries leave this off — they consume their OWN reservation.
   */
  respectReservations?: boolean;
}

export type ReceiveOptions = IssueOptions;

/** What an issued line actually cost (weighted-average at issue time). */
export interface IssuedLine {
  warehouseId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(WarehouseStock)
    private readonly stockRepository: Repository<WarehouseStock>,
    @InjectRepository(StockMovement)
    private readonly movementRepository: Repository<StockMovement>,
  ) {}

  /** Paginated stock-movements ledger (enriched with product + warehouse). */
  async findMovements(
    query: StockMovementQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<StockMovement>> {
    const qb = this.movementRepository
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.product', 'product')
      .leftJoinAndSelect('m.warehouse', 'warehouse');

    this.applyMovementFilters(qb, query, branchScope);

    qb.orderBy('m.movementDate', 'DESC').addOrderBy('m.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  /**
   * The movements ledger's filters, shared by the page query and the summary
   * cards. Expects the `product` and `warehouse` aliases to be joined on `m`.
   */
  private applyMovementFilters(
    qb: ReturnType<Repository<StockMovement>['createQueryBuilder']>,
    query: StockMovementQueryDto,
    branchScope: BranchScope,
  ): void {
    // Branch-restricted users only see movements in their own branch's warehouses.
    applyBranchScope(qb, 'warehouse.branchId', branchScope);
    if (query.warehouseId) qb.andWhere('m.warehouseId = :wh', { wh: query.warehouseId });
    if (query.productId) qb.andWhere('m.productId = :pid', { pid: query.productId });
    if (query.direction) qb.andWhere('m.direction = :dir', { dir: query.direction });
    if (query.movementType) qb.andWhere('m.movementType = :mt', { mt: query.movementType });
    if (query.dateFrom) qb.andWhere('m.movementDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('m.movementDate <= :dt', { dt: query.dateTo });
    if (query.search) {
      qb.andWhere('(product.code LIKE :s OR product.name LIKE :s OR m.sourceNumber LIKE :s)', {
        s: `%${query.search}%`,
      });
    }
  }

  /**
   * Analysis cards for the movements ledger, over EXACTLY the ledger's filters.
   * Movements are immutable facts (no draft state), so every matching row counts.
   * Values are quantity x the movement's recorded unit cost.
   */
  async movementsSummary(query: StockMovementQueryDto, branchScope: BranchScope = null) {
    const qb = this.movementRepository
      .createQueryBuilder('m')
      .leftJoin('m.product', 'product')
      .leftJoin('m.warehouse', 'warehouse');
    this.applyMovementFilters(qb, query, branchScope);
    const raw = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect(`SUM(CASE WHEN m.direction = 'in' THEN 1 ELSE 0 END)`, 'inCnt')
      .addSelect(`SUM(CASE WHEN m.direction = 'out' THEN 1 ELSE 0 END)`, 'outCnt')
      .addSelect(`COALESCE(SUM(CASE WHEN m.direction = 'in' THEN m.quantity ELSE 0 END), 0)`, 'qtyIn')
      .addSelect(`COALESCE(SUM(CASE WHEN m.direction = 'out' THEN m.quantity ELSE 0 END), 0)`, 'qtyOut')
      .addSelect(`COALESCE(SUM(CASE WHEN m.direction = 'in' THEN m.quantity * m.unitCost ELSE 0 END), 0)`, 'valIn')
      .addSelect(`COALESCE(SUM(CASE WHEN m.direction = 'out' THEN m.quantity * m.unitCost ELSE 0 END), 0)`, 'valOut')
      .addSelect('COUNT(DISTINCT m.productId)', 'products')
      .getRawOne<Record<string, string | null>>();
    const n = (k: string) => Number(raw?.[k] ?? 0) || 0;
    const quantityIn = round3(n('qtyIn'));
    const quantityOut = round3(n('qtyOut'));
    const valueIn = round2(n('valIn'));
    const valueOut = round2(n('valOut'));
    return {
      count: n('cnt'),
      inCount: n('inCnt'),
      outCount: n('outCnt'),
      productsCount: n('products'),
      quantityIn,
      quantityOut,
      netQuantity: round3(quantityIn - quantityOut),
      valueIn,
      valueOut,
      netValue: round2(valueIn - valueOut),
    };
  }

  /**
   * Apply opening stock inside the caller's transaction: record an IN movement
   * per line and upsert the running warehouse balance (weighted-average cost).
   */
  async applyOpening(
    items: OpeningStockItem[],
    manager: EntityManager,
    opts: ApplyOpeningOptions,
  ): Promise<void> {
    const movementRepo = manager.getRepository(StockMovement);
    const stockRepo = manager.getRepository(WarehouseStock);

    for (const item of items) {
      const quantity = item.quantity || 0;
      const unitCost = item.unitCost || 0;

      await movementRepo.save(
        movementRepo.create({
          warehouseId: item.warehouseId,
          productId: item.productId,
          direction: StockDirection.IN,
          movementType: StockMovementType.OPENING,
          quantity,
          unitCost,
          movementDate: opts.movementDate,
          sourceType: 'opening_balance',
          sourceId: opts.sourceId,
          notes: item.notes ?? null,
          createdBy: opts.actorId ?? null,
        }),
      );

      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
      });

      if (!existing) {
        await stockRepo.save(
          stockRepo.create({
            warehouseId: item.warehouseId,
            productId: item.productId,
            quantity,
            avgCost: unitCost,
          }),
        );
        continue;
      }

      const newQty = existing.quantity + quantity;
      // Weighted-average cost over the combined quantity.
      existing.avgCost =
        newQty > 0
          ? round2((existing.quantity * existing.avgCost + quantity * unitCost) / newQty)
          : unitCost;
      existing.quantity = newQty;
      await stockRepo.save(existing);
    }
  }

  /**
   * Reverse previously-applied opening stock inside the caller's transaction:
   * record an OUT/opening-reversal movement per line and decrement the running
   * balance using the ORIGINAL opening quantity & cost (the source of truth,
   * not the current product cost). Quantity may go negative when the caller has
   * force-confirmed — later transactions are never touched. Weighted-average
   * cost is preserved on the remaining quantity.
   */
  async applyReversal(
    items: OpeningStockItem[],
    manager: EntityManager,
    opts: ApplyOpeningOptions,
  ): Promise<void> {
    const movementRepo = manager.getRepository(StockMovement);
    const stockRepo = manager.getRepository(WarehouseStock);

    for (const item of items) {
      const quantity = item.quantity || 0;
      const unitCost = item.unitCost || 0;

      await movementRepo.save(
        movementRepo.create({
          warehouseId: item.warehouseId,
          productId: item.productId,
          direction: StockDirection.OUT,
          movementType: StockMovementType.OPENING_REVERSAL,
          quantity,
          unitCost,
          movementDate: opts.movementDate,
          sourceType: 'opening_balance_reversal',
          sourceId: opts.sourceId,
          notes: item.notes ?? null,
          createdBy: opts.actorId ?? null,
        }),
      );

      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
      });

      if (!existing) {
        // No balance row yet — reversal drives it negative (force path).
        await stockRepo.save(
          stockRepo.create({
            warehouseId: item.warehouseId,
            productId: item.productId,
            quantity: -quantity,
            avgCost: unitCost,
          }),
        );
        continue;
      }

      existing.quantity = round3(existing.quantity - quantity);
      // avgCost of the remaining on-hand quantity is unchanged by a removal.
      await stockRepo.save(existing);
    }
  }

  /**
   * Issue stock OUT of a warehouse (sales, purchase-returns, reversals of a
   * receive). Each balance row is locked (`pessimistic_write`) before it is read
   * and decremented, so two concurrent posts can never both pass the
   * availability check and oversell. Unless `allowNegative`, a shortfall throws
   * an Arabic error. Returns the weighted-average unit cost each line was issued
   * at — the caller uses this for COGS. Removing stock does not change avgCost.
   */
  async issue(
    items: StockLineInput[],
    manager: EntityManager,
    opts: IssueOptions,
  ): Promise<IssuedLine[]> {
    const movementRepo = manager.getRepository(StockMovement);
    const stockRepo = manager.getRepository(WarehouseStock);
    const issued: IssuedLine[] = [];

    for (const item of items) {
      const quantity = item.quantity || 0;

      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
        lock: { mode: 'pessimistic_write' },
      });

      const onHand = existing?.quantity ?? 0;
      const reserved = opts.respectReservations ? Math.max(0, existing?.reservedQuantity ?? 0) : 0;
      const available = onHand - reserved;
      // A warehouse configured «يسمح بالرصيد السالب» may go below zero physically,
      // but never takes goods reserved for customers (respectReservations).
      const warehouseAllowsNegative =
        !opts.allowNegative && !opts.respectReservations && available + 1e-6 < quantity
          ? await this.warehouseAllowsNegative(item.warehouseId, manager)
          : false;
      if (!opts.allowNegative && !warehouseAllowsNegative && available + 1e-6 < quantity) {
        throw new BadRequestException(
          reserved > 0
            ? `الكمية المتاحة من المنتج ${item.productName ?? ''} هي ${round3(Math.max(0, available))} فقط ` +
              `(الرصيد ${round3(onHand)} منها ${round3(reserved)} محجوزة لفواتير مبيعات لم تُسلَّم بعد)، ولا يمكن ترحيل كمية ${quantity}.`
            : `الكمية المتاحة من المنتج ${item.productName ?? ''} هي ${round3(onHand)} فقط، ولا يمكن ترحيل كمية ${quantity}.`,
        );
      }

      const unitCost = round2(existing?.avgCost ?? item.unitCost ?? 0);

      await movementRepo.save(
        movementRepo.create({
          warehouseId: item.warehouseId,
          productId: item.productId,
          direction: StockDirection.OUT,
          movementType: opts.movementType,
          quantity,
          unitCost,
          movementDate: opts.movementDate,
          sourceType: opts.sourceType,
          sourceId: opts.sourceId,
          sourceNumber: opts.sourceNumber ?? null,
          createdBy: opts.actorId ?? null,
        }),
      );

      if (existing) {
        existing.quantity = round3(existing.quantity - quantity);
        await stockRepo.save(existing);
      } else {
        await stockRepo.save(
          stockRepo.create({
            warehouseId: item.warehouseId,
            productId: item.productId,
            quantity: round3(-quantity),
            avgCost: unitCost,
          }),
        );
      }

      issued.push({
        warehouseId: item.warehouseId,
        productId: item.productId,
        quantity,
        unitCost,
        totalCost: round2(quantity * unitCost),
      });
    }

    return issued;
  }

  /** Warehouse policy flag «يسمح بالرصيد السالب». */
  private async warehouseAllowsNegative(warehouseId: string, manager: EntityManager): Promise<boolean> {
    const wh = await manager.getRepository(Warehouse).findOne({
      where: { id: warehouseId },
      select: { id: true, allowNegativeStock: true },
      withDeleted: true,
    });
    return !!wh?.allowNegativeStock;
  }

  /**
   * Soft-reserve stock for posted-but-undelivered sales lines. Increases
   * `reservedQuantity` only — never `quantity`, never a movement row. Over-
   * reservation is allowed (matching the "sell then procure" flow; availability
   * is surfaced to the user before posting). Upserts the balance row if absent.
   */
  async reserve(items: StockLineInput[], manager: EntityManager): Promise<void> {
    const stockRepo = manager.getRepository(WarehouseStock);
    for (const item of items) {
      const quantity = item.quantity || 0;
      if (quantity <= 0) continue;
      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        existing.reservedQuantity = round3(existing.reservedQuantity + quantity);
        await stockRepo.save(existing);
      } else {
        await stockRepo.save(
          stockRepo.create({
            warehouseId: item.warehouseId,
            productId: item.productId,
            quantity: 0,
            reservedQuantity: round3(quantity),
            avgCost: 0,
          }),
        );
      }
    }
  }

  /**
   * Release a previously-held reservation — on delivery (goods actually issued)
   * or when a reserving invoice is reversed. Decreases `reservedQuantity`,
   * floored at zero. The row is locked before update.
   */
  async releaseReservation(items: StockLineInput[], manager: EntityManager): Promise<void> {
    const stockRepo = manager.getRepository(WarehouseStock);
    for (const item of items) {
      const quantity = item.quantity || 0;
      if (quantity <= 0) continue;
      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) continue;
      existing.reservedQuantity = round3(Math.max(0, existing.reservedQuantity - quantity));
      await stockRepo.save(existing);
    }
  }

  /**
   * Receive stock INTO a warehouse (purchases, sale-returns, reversal of a
   * sale). Records an IN movement at the supplied `unitCost` and folds it into
   * the running weighted-average balance. The row is locked before update.
   */
  async receive(
    items: StockLineInput[],
    manager: EntityManager,
    opts: ReceiveOptions,
  ): Promise<void> {
    const movementRepo = manager.getRepository(StockMovement);
    const stockRepo = manager.getRepository(WarehouseStock);

    for (const item of items) {
      const quantity = item.quantity || 0;
      const unitCost = round2(item.unitCost ?? 0);

      await movementRepo.save(
        movementRepo.create({
          warehouseId: item.warehouseId,
          productId: item.productId,
          direction: StockDirection.IN,
          movementType: opts.movementType,
          quantity,
          unitCost,
          movementDate: opts.movementDate,
          sourceType: opts.sourceType,
          sourceId: opts.sourceId,
          sourceNumber: opts.sourceNumber ?? null,
          createdBy: opts.actorId ?? null,
        }),
      );

      const existing = await stockRepo.findOne({
        where: { warehouseId: item.warehouseId, productId: item.productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!existing) {
        await stockRepo.save(
          stockRepo.create({
            warehouseId: item.warehouseId,
            productId: item.productId,
            quantity,
            avgCost: unitCost,
          }),
        );
        continue;
      }

      const newQty = round3(existing.quantity + quantity);
      existing.avgCost =
        newQty > 0
          ? round2(
              (existing.quantity * existing.avgCost + quantity * unitCost) / newQty,
            )
          : unitCost;
      existing.quantity = newQty;
      await stockRepo.save(existing);
    }
  }

  /** Paginated on-hand balances, optionally filtered by warehouse. */
  async findAll(
    query: PaginationQueryDto,
    warehouseId?: string,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<WarehouseStock>> {
    const qb = this.stockRepository
      .createQueryBuilder('stock')
      .leftJoinAndSelect('stock.product', 'product')
      .leftJoinAndSelect('product.unit', 'unit')
      .leftJoinAndSelect('stock.warehouse', 'warehouse');

    this.applyBalanceFilters(qb, { search: query.search, warehouseId }, branchScope);

    qb.orderBy('product.code', query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  /**
   * The balances list's filters, shared by the page query and the summary cards.
   * Expects the `product` and `warehouse` aliases to be joined on `stock`.
   */
  private applyBalanceFilters(
    qb: ReturnType<Repository<WarehouseStock>['createQueryBuilder']>,
    query: { search?: string; warehouseId?: string },
    branchScope: BranchScope,
  ): void {
    // Branch-restricted users only see stock in their own branch's warehouses.
    applyBranchScope(qb, 'warehouse.branchId', branchScope);
    if (query.warehouseId) {
      qb.andWhere('stock.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    }
    if (query.search) {
      qb.andWhere('(product.code LIKE :s OR product.name LIKE :s)', {
        s: `%${query.search}%`,
      });
    }
  }

  /**
   * Analysis cards for the balances list, over EXACTLY the list's filters. One
   * balance row = one product in one warehouse; the reorder check compares each
   * row's on-hand quantity with the product's reorder point (when one is set).
   */
  async balancesSummary(query: StockQueryDto, branchScope: BranchScope = null) {
    const qb = this.stockRepository
      .createQueryBuilder('stock')
      .leftJoin('stock.product', 'product')
      .leftJoin('stock.warehouse', 'warehouse');
    this.applyBalanceFilters(qb, query, branchScope);
    const raw = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect('COUNT(DISTINCT stock.productId)', 'products')
      .addSelect('COALESCE(SUM(stock.quantity), 0)', 'qty')
      .addSelect('COALESCE(SUM(stock.reservedQuantity), 0)', 'reserved')
      .addSelect('COALESCE(SUM(stock.quantity * stock.avgCost), 0)', 'value')
      .addSelect(
        `SUM(CASE WHEN product.reorderPoint > 0 AND stock.quantity > 0 AND stock.quantity <= product.reorderPoint THEN 1 ELSE 0 END)`,
        'belowReorder',
      )
      .addSelect(`SUM(CASE WHEN stock.quantity <= 0 THEN 1 ELSE 0 END)`, 'nonPositive')
      .addSelect(`SUM(CASE WHEN stock.quantity < 0 THEN 1 ELSE 0 END)`, 'negative')
      .getRawOne<Record<string, string | null>>();
    const n = (k: string) => Number(raw?.[k] ?? 0) || 0;
    return {
      count: n('cnt'),
      productsCount: n('products'),
      totalQuantity: round3(n('qty')),
      reservedQuantity: round3(n('reserved')),
      stockValue: round2(n('value')),
      belowReorderCount: n('belowReorder'),
      nonPositiveCount: n('nonPositive'),
      negativeCount: n('negative'),
    };
  }

  /** Products present in one warehouse with their on-hand quantity + weighted-avg
   *  cost. Powers the manufacturing BOM editor: pick the warehouse first, then the
   *  component from what's actually available there. */
  async costs(
    warehouseId: string,
    branchScope: BranchScope = null,
    productType?: string,
  ): Promise<
    {
      productId: string; productCode: string | null; productName: string | null; unitName: string | null;
      avgCost: number; quantity: number;
      /** Reserved for posted, undelivered sales invoices. */
      reservedQuantity: number;
      /** quantity − reservedQuantity: what can leave the warehouse now. */
      available: number;
    }[]
  > {
    const qb = this.stockRepository
      .createQueryBuilder('stock')
      .leftJoin('stock.warehouse', 'warehouse')
      .leftJoin('stock.product', 'product')
      .leftJoin('product.unit', 'unit')
      .select('stock.productId', 'productId')
      .addSelect('product.code', 'productCode')
      .addSelect('product.name', 'productName')
      .addSelect('unit.name', 'unitName')
      .addSelect('stock.avgCost', 'avgCost')
      .addSelect('stock.quantity', 'quantity')
      .addSelect('stock.reservedQuantity', 'reserved')
      .where('stock.warehouseId = :warehouseId', { warehouseId })
      .orderBy('product.name', 'ASC');
    if (productType) qb.andWhere('product.productType = :productType', { productType });
    applyBranchScope(qb, 'warehouse.branchId', branchScope);
    const rows = await qb.getRawMany<{
      productId: string;
      productCode: string | null;
      productName: string | null;
      unitName: string | null;
      avgCost: string;
      quantity: string;
      reserved: string | null;
    }>();
    return rows.map((r) => ({
      productId: r.productId,
      productCode: r.productCode ?? null,
      productName: r.productName ?? null,
      unitName: r.unitName ?? null,
      avgCost: Number(r.avgCost ?? 0),
      quantity: Number(r.quantity ?? 0),
      reservedQuantity: Number(r.reserved ?? 0),
      available: round3(Number(r.quantity ?? 0) - Number(r.reserved ?? 0)),
    }));
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
