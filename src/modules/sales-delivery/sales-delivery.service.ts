import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { SalesDelivery } from './entities/sales-delivery.entity';
import { SalesDeliveryItem } from './entities/sales-delivery-item.entity';
import {
  SalesDeliveryProgress,
  SalesDeliverySource,
  SalesDeliveryStatus,
} from './enums/sales-delivery.enum';
import { CreateSalesDeliveryDto, SalesDeliveryItemDto } from './dto/create-sales-delivery.dto';
import { UpdateSalesDeliveryDto } from './dto/update-sales-delivery.dto';
import { SalesDeliveryQueryDto } from './dto/sales-delivery-query.dto';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceStatus, SalesLineType } from '../sales-invoice/enums/sales-invoice.enum';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Product } from '../product/entities/product.entity';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { User } from '../user/entities/user.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface SalesDeliveryListItem {
  id: string;
  deliveryNumber: string | null;
  deliveryDate: string;
  source: SalesDeliverySource;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string | null;
  warehouseName: string | null;
  itemsCount: number;
  totalCost: number;
  status: SalesDeliveryStatus;
  deliveryProgress: SalesDeliveryProgress;
}

/** A deliverable invoice line: ordered vs already-delivered vs remaining. */
export interface DeliverableLine {
  salesInvoiceItemId: string;
  productId: string;
  productCode: string | null;
  productName: string | null;
  unitId: string | null;
  unitName: string | null;
  orderedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

@Injectable()
export class SalesDeliveryService {
  constructor(
    @InjectRepository(SalesDelivery)
    private readonly repository: Repository<SalesDelivery>,
    @InjectRepository(SalesDeliveryItem)
    private readonly itemRepository: Repository<SalesDeliveryItem>,
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepository: Repository<SalesInvoice>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /** The still-deliverable STOCK lines of a POSTED invoice (ordered − delivered). */
  async deliverableItems(
    invoiceId: string,
  ): Promise<{ invoice: Record<string, unknown>; lines: DeliverableLine[] }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    if (invoice.status !== SalesInvoiceStatus.POSTED) {
      throw new BadRequestException('لا يمكن التسليم إلا من فاتورة مُرحّلة');
    }
    // Only stock lines are deliverable (manufacturing lines never touch stock).
    const stockItems = invoice.items.filter((i) => i.lineType === SalesLineType.STOCK);
    const delivered = await this.deliveredQtyByItem(stockItems.map((i) => i.id));
    const lines: DeliverableLine[] = stockItems.map((it) => {
      const deliveredQty = delivered.get(it.id) ?? 0;
      return {
        salesInvoiceItemId: it.id,
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        unitId: it.unitId,
        unitName: it.unitName,
        orderedQuantity: it.quantity,
        deliveredQuantity: round3(deliveredQty),
        remainingQuantity: round3(it.quantity - deliveredQty),
      };
    });
    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        warehouseId: invoice.warehouseId,
        branchId: invoice.branchId,
      },
      lines,
    };
  }

  /**
   * Auto-create ONE draft delivery note for a just-posted invoice's stock lines,
   * pre-filled with the full ordered quantity. No-op if the invoice has no stock
   * lines or a delivery note already exists for it. A DRAFT has no stock/accounting
   * effect — the user sets the actual delivery date and per-line quantities, then posts.
   */
  async autoCreateForInvoice(invoiceId: string, actorId?: string): Promise<SalesDelivery | null> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice || invoice.status !== SalesInvoiceStatus.POSTED) return null;
    // Don't duplicate if an order already exists for this invoice.
    if (await this.repository.count({ where: { salesInvoiceId: invoiceId } })) return null;
    // Deliverable lines = stock (now) + manufacturing (wait for production). Service
    // lines never ship. Manufacturing lines sit with no warehouse until produced.
    const deliverable = invoice.items.filter((i) => i.lineType !== SalesLineType.SERVICE);
    if (!deliverable.length) return null;

    // Link each manufacturing line to the production order spawned for it.
    const mfgItemIds = deliverable
      .filter((i) => i.lineType === SalesLineType.MANUFACTURING)
      .map((i) => i.id);
    const orders = mfgItemIds.length
      ? await this.repository.manager.getRepository(ManufacturingOrder).find({
          where: { salesInvoiceItemId: In(mfgItemIds) },
        })
      : [];
    const moByItem = new Map(orders.map((o): [string, string] => [o.salesInvoiceItemId!, o.id]));

    const headerWarehouse =
      invoice.warehouseId ??
      deliverable.find((i) => i.lineType === SalesLineType.STOCK)?.warehouseId ??
      null;

    const delivery = this.repository.create({
      deliveryNumber: null,
      deliveryDate: invoice.invoiceDate,
      expectedDeliveryDate: null,
      deliveryProgress: SalesDeliveryProgress.PENDING,
      source: SalesDeliverySource.INVOICE,
      salesInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      warehouseId: headerWarehouse,
      branchId: invoice.branchId,
      fiscalYearId: invoice.fiscalYearId,
      accountingPeriodId: invoice.accountingPeriodId,
      status: SalesDeliveryStatus.DRAFT,
      createdBy: actorId ?? null,
      items: deliverable.map((it, idx) => {
        const isMfg = it.lineType === SalesLineType.MANUFACTURING;
        return {
          lineNumber: idx + 1,
          salesInvoiceItemId: it.id,
          productId: it.productId,
          // A manufacturing line gets its warehouse at production time.
          warehouseId: isMfg ? null : it.warehouseId ?? invoice.warehouseId ?? null,
          manufacturingOrderId: isMfg ? moByItem.get(it.id) ?? null : null,
          unitId: it.unitId,
          productCode: it.productCode,
          productName: it.productName,
          unitName: it.unitName,
          lineType: it.lineType ?? SalesLineType.STOCK,
          orderedQuantity: it.quantity,
          deliveredQuantity: 0,
          quantity: 0,
          actualDeliveryDate: null,
          unitCostAtPost: 0,
          lineCost: 0,
        };
      }),
    });
    return this.repository.save(delivery);
  }

  // =========================================================
  // CREATE / UPDATE / DELETE (DRAFT only)
  // =========================================================
  async create(dto: CreateSalesDeliveryDto, actorId?: string): Promise<SalesDelivery> {
    await this.assertPeriod(dto.fiscalYearId, dto.accountingPeriodId);

    const header =
      dto.source === SalesDeliverySource.INVOICE
        ? await this.buildFromInvoice(dto)
        : await this.buildStandalone(dto);

    const delivery = this.repository.create({
      deliveryNumber: null,
      deliveryDate: dto.deliveryDate,
      source: dto.source,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      status: SalesDeliveryStatus.DRAFT,
      notes: dto.notes ?? null,
      createdBy: actorId ?? null,
      ...header,
    });
    return this.repository.save(delivery);
  }

  async update(id: string, dto: UpdateSalesDeliveryDto, actorId?: string): Promise<SalesDelivery> {
    const delivery = await this.getEditableDraft(id);
    if (dto.deliveryDate) delivery.deliveryDate = dto.deliveryDate;
    if (dto.fiscalYearId) delivery.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) delivery.accountingPeriodId = dto.accountingPeriodId;
    if (dto.notes !== undefined) delivery.notes = dto.notes ?? null;
    await this.assertPeriod(delivery.fiscalYearId, delivery.accountingPeriodId);

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        const rebuilt =
          delivery.source === SalesDeliverySource.INVOICE
            ? await this.buildFromInvoice(
                { ...dto, source: SalesDeliverySource.INVOICE, salesInvoiceId: delivery.salesInvoiceId! } as CreateSalesDeliveryDto,
                id,
              )
            : await this.buildStandalone({
                ...dto,
                source: SalesDeliverySource.STANDALONE,
                customerId: delivery.customerId,
                warehouseId: delivery.warehouseId,
                branchId: delivery.branchId,
              } as CreateSalesDeliveryDto);
        await manager.delete(SalesDeliveryItem, { salesDeliveryId: id });
        delivery.items = rebuilt.items ?? [];
      }
      delivery.updatedBy = actorId ?? null;
      return manager.getRepository(SalesDelivery).save(delivery);
    });
  }

  async remove(id: string, actorId?: string): Promise<void> {
    await this.getEditableDraft(id);
    await this.repository.update(id, { deletedBy: actorId ?? null });
    await this.repository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: SalesDeliveryQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<SalesDeliveryListItem>> {
    const qb = this.repository.createQueryBuilder('d');
    applyBranchScope(qb, 'd.branchId', branchScope);
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('d.deliveryNumber LIKE :s', { s: `%${query.search}%` }).orWhere('d.invoiceNumber LIKE :s', {
            s: `%${query.search}%`,
          });
        }),
      );
    }
    if (query.customerId) qb.andWhere('d.customerId = :cu', { cu: query.customerId });
    if (query.salesInvoiceId) qb.andWhere('d.salesInvoiceId = :si', { si: query.salesInvoiceId });
    if (query.warehouseId) qb.andWhere('d.warehouseId = :wh', { wh: query.warehouseId });
    if (query.fiscalYearId) qb.andWhere('d.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.status) qb.andWhere('d.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('d.deliveryDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('d.deliveryDate <= :dt', { dt: query.dateTo });
    qb.leftJoinAndSelect('d.items', 'items');
    qb.orderBy('d.deliveryDate', 'DESC').addOrderBy('d.createdAt', 'DESC').skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const [customerNames, warehouseNames] = await Promise.all([
      this.nameMap(this.customerRepository, items.map((i) => i.customerId)),
      this.nameMap(this.warehouseRepository, items.map((i) => i.warehouseId)),
    ]);
    const rows: SalesDeliveryListItem[] = items.map((d) => ({
      id: d.id,
      deliveryNumber: d.deliveryNumber,
      deliveryDate: d.deliveryDate,
      source: d.source,
      invoiceNumber: d.invoiceNumber,
      customerId: d.customerId,
      customerName: customerNames.get(d.customerId) ?? null,
      warehouseName: d.warehouseId ? warehouseNames.get(d.warehouseId) ?? null : null,
      itemsCount: d.items?.length ?? 0,
      totalCost: d.totalCost,
      status: d.status,
      deliveryProgress: d.deliveryProgress,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<SalesDelivery> {
    const d = await this.repository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!d || !isWithinBranchScope(d.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على إذن التسليم');
    }
    return d;
  }

  /** Set the planned/expected delivery date of an order. */
  async setExpectedDate(
    id: string,
    expectedDeliveryDate: string,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<SalesDelivery> {
    const d = await this.findOne(id, branchScope);
    d.expectedDeliveryDate = expectedDeliveryDate;
    d.updatedBy = actorId ?? null;
    return this.repository.save(d);
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const d = await this.findOne(id, branchScope);
    const [customer, warehouse, branch, fiscalYear, period, users] = await Promise.all([
      this.customerRepository.findOne({ where: { id: d.customerId } }),
      d.warehouseId ? this.warehouseRepository.findOne({ where: { id: d.warehouseId } }) : null,
      d.branchId ? this.branchRepository.findOne({ where: { id: d.branchId } }) : null,
      this.fiscalYearRepository.findOne({ where: { id: d.fiscalYearId } }),
      this.periodRepository.findOne({ where: { id: d.accountingPeriodId } }),
      this.userNames([d.createdBy, d.postedBy, d.reversedBy]),
    ]);
    return {
      ...d,
      customerName: customer?.name ?? null,
      warehouseName: warehouse?.name ?? null,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(d.createdBy ?? '') ?? null,
      postedByName: users.get(d.postedBy ?? '') ?? null,
      reversedByName: users.get(d.reversedBy ?? '') ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async buildFromInvoice(
    dto: CreateSalesDeliveryDto,
    excludeDeliveryId?: string,
  ): Promise<Partial<SalesDelivery>> {
    if (!dto.salesInvoiceId) throw new BadRequestException('يجب اختيار الفاتورة للتسليم من فاتورة');
    const invoice = await this.loadPostedInvoice(dto.salesInvoiceId);
    const itemById = new Map(invoice.items.map((i): [string, SalesInvoiceItem] => [i.id, i]));
    const alreadyDelivered = await this.deliveredQtyByItem(invoice.items.map((i) => i.id), excludeDeliveryId);

    const requested = new Map<string, number>();
    for (const d of dto.items) {
      if (!d.salesInvoiceItemId) throw new BadRequestException('سطر بدون مرجع في الفاتورة');
      requested.set(d.salesInvoiceItemId, round3((requested.get(d.salesInvoiceItemId) ?? 0) + d.quantity));
    }

    const items = dto.items.map((d, index) => {
      const src = itemById.get(d.salesInvoiceItemId!);
      if (!src) throw new BadRequestException('أحد السطور لا يخص هذه الفاتورة');
      if (src.lineType !== SalesLineType.STOCK) {
        throw new BadRequestException(`الصنف "${src.productName}" تصنيع ولا يُسلّم من المخزن`);
      }
      const remaining = round3(src.quantity - (alreadyDelivered.get(src.id) ?? 0));
      if (requested.get(src.id)! - remaining > 1e-6) {
        throw new BadRequestException(`الكمية المُسلّمة من "${src.productName}" تتجاوز المتبقي (${remaining})`);
      }
      const item = new SalesDeliveryItem();
      item.lineNumber = index + 1;
      item.salesInvoiceItemId = src.id;
      item.productId = src.productId;
      // Ship each line from the warehouse chosen on its invoice line (a stock
      // line always has one — manufacturing lines were rejected above).
      if (!src.warehouseId) {
        throw new BadRequestException(`الصنف "${src.productName}" بدون مخزن ولا يمكن تسليمه`);
      }
      item.warehouseId = src.warehouseId;
      item.unitId = src.unitId;
      item.productCode = src.productCode;
      item.productName = src.productName;
      item.unitName = src.unitName;
      item.quantity = d.quantity;
      item.unitCostAtPost = 0;
      item.lineCost = 0;
      return item;
    });

    return {
      source: SalesDeliverySource.INVOICE,
      salesInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      // Representative header warehouse = the first delivered line's.
      warehouseId: items[0]?.warehouseId ?? invoice.warehouseId ?? undefined,
      branchId: invoice.branchId,
      items,
    };
  }

  private async buildStandalone(dto: CreateSalesDeliveryDto): Promise<Partial<SalesDelivery>> {
    if (!dto.customerId) throw new BadRequestException('يجب اختيار العميل للتسليم المستقل');
    if (!dto.warehouseId) throw new BadRequestException('يجب اختيار المخزن للتسليم المستقل');

    const productIds = [...new Set(dto.items.map((i) => i.productId).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.productRepository.find({ where: { id: In(productIds) } })
      : [];
    const productById = new Map(products.map((p): [string, Product] => [p.id, p]));

    const items = dto.items.map((d, index) => {
      if (!d.productId) throw new BadRequestException('سطر بدون منتج');
      const product = productById.get(d.productId);
      if (!product) throw new BadRequestException('أحد المنتجات غير موجود');
      const item = new SalesDeliveryItem();
      item.lineNumber = index + 1;
      item.salesInvoiceItemId = null;
      item.productId = product.id;
      item.warehouseId = dto.warehouseId!;
      item.unitId = d.unitId ?? null;
      item.productCode = product.code;
      item.productName = product.name;
      item.unitName = null;
      item.quantity = d.quantity;
      item.unitCostAtPost = 0;
      item.lineCost = 0;
      return item;
    });

    return {
      source: SalesDeliverySource.STANDALONE,
      salesInvoiceId: null,
      invoiceNumber: null,
      customerId: dto.customerId,
      warehouseId: dto.warehouseId,
      branchId: dto.branchId ?? null,
      items,
    };
  }

  /** SUM of delivered quantity per invoice item across non-reversed deliveries. */
  private async deliveredQtyByItem(
    invoiceItemIds: string[],
    excludeDeliveryId?: string,
  ): Promise<Map<string, number>> {
    if (!invoiceItemIds.length) return new Map();
    const qb = this.itemRepository
      .createQueryBuilder('di')
      .innerJoin('di.salesDelivery', 'd')
      .select('di.salesInvoiceItemId', 'itemId')
      .addSelect('COALESCE(SUM(di.quantity), 0)', 'qty')
      .where('di.salesInvoiceItemId IN (:...ids)', { ids: invoiceItemIds })
      .andWhere('d.status != :reversed', { reversed: SalesDeliveryStatus.REVERSED })
      .groupBy('di.salesInvoiceItemId');
    if (excludeDeliveryId) qb.andWhere('d.id != :ex', { ex: excludeDeliveryId });
    const rows = await qb.getRawMany<{ itemId: string; qty: string }>();
    return new Map(rows.map((r): [string, number] => [r.itemId, Number(r.qty)]));
  }

  private async loadPostedInvoice(invoiceId: string): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    if (invoice.status !== SalesInvoiceStatus.POSTED) {
      throw new BadRequestException('لا يمكن التسليم إلا من فاتورة مُرحّلة');
    }
    return invoice;
  }

  private async getEditableDraft(id: string): Promise<SalesDelivery> {
    const d = await this.findOne(id);
    if (d.status !== SalesDeliveryStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف إذن تسليم مُرحّل — استخدم العكس');
    }
    return d;
  }

  private async assertPeriod(fiscalYearId: string, periodId: string): Promise<void> {
    const period = await this.periodRepository.findOne({ where: { id: periodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYearId) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
  }

  private async nameMap<T extends { id: string; name: string }>(
    repo: Repository<T>,
    ids: (string | null)[],
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
