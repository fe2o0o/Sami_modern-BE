import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { SalesReturnStatus } from './enums/sales-return.enum';
import { CreateSalesReturnDto, SalesReturnItemDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { SalesReturnQueryDto } from './dto/sales-return-query.dto';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceStatus, SalesLineType } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { Product } from '../product/entities/product.entity';
import { SalesDeliveryStatus } from '../sales-delivery/enums/sales-delivery.enum';
import { round2 } from '../sales-invoice/sales-math';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface SalesReturnListItem {
  id: string;
  returnNumber: string | null;
  returnDate: string;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string | null;
  totalAmount: number;
  status: SalesReturnStatus;
}

/** A returnable line of an invoice: sold vs already-returned vs remaining. */
export interface ReturnableLine {
  salesInvoiceItemId: string;
  productId: string;
  productCode: string | null;
  productName: string | null;
  unitName: string | null;
  lineType: string;
  /** Quantity on the invoice line. */
  invoicedQuantity: number;
  /** Quantity actually delivered (equals invoiced for lines that never ship through a delivery note). */
  deliveredQuantity: number;
  /** The returnable basis: delivered goods for stock lines, invoiced quantity otherwise. */
  soldQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
  /** Why nothing can be returned on this line right now (null = returnable). */
  blockedReason: string | null;
}

@Injectable()
export class SalesReturnService {
  constructor(
    @InjectRepository(SalesReturn)
    private readonly repository: Repository<SalesReturn>,
    @InjectRepository(SalesReturnItem)
    private readonly itemRepository: Repository<SalesReturnItem>,
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepository: Repository<SalesInvoice>,
    @InjectRepository(SalesInvoiceItem)
    private readonly invoiceItemRepository: Repository<SalesInvoiceItem>,
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  /** The returnable lines of a POSTED invoice (sold − already returned). */
  async returnableItems(invoiceId: string): Promise<{ invoice: Record<string, unknown>; lines: ReturnableLine[] }> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');
    if (invoice.status !== SalesInvoiceStatus.POSTED) {
      throw new BadRequestException('لا يمكن إنشاء مردود إلا من فاتورة مُرحّلة');
    }
    const returned = await this.returnedQtyByItem(invoice.items.map((i) => i.id));
    // Only DELIVERED goods are returnable. Manufacturing, service and
    // non-inventory lines never ship through a delivery note, so they fall back
    // to the invoiced quantity (they were "delivered" at invoicing).
    const delivered = await this.deliveredInfoByItem(invoice.items.map((i) => i.id));
    const ships = await this.shipsViaDeliveryByItem(invoice.items);
    const lines: ReturnableLine[] = invoice.items.map((it) => {
      const returnedQty = returned.get(it.id) ?? 0;
      const shipsViaDelivery = ships.get(it.id) ?? false;
      const deliveredQty = shipsViaDelivery ? (delivered.get(it.id)?.qty ?? 0) : it.quantity;
      const basis = deliveredQty;
      const remaining = round3(basis - returnedQty);
      let blockedReason: string | null = null;
      if (shipsViaDelivery && deliveredQty <= 0) blockedReason = 'لم يُسلَّم بعد — المرتجع يُبنى على الكميات المُسلَّمة فقط';
      else if (remaining <= 0) blockedReason = 'تم إرجاع الكمية بالكامل';
      return {
        salesInvoiceItemId: it.id,
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        unitName: it.unitName,
        lineType: it.lineType,
        invoicedQuantity: it.quantity,
        deliveredQuantity: round3(deliveredQty),
        soldQuantity: round3(basis),
        returnedQuantity: round3(returnedQty),
        remainingQuantity: remaining,
        unitPrice: it.unitPrice,
        blockedReason,
      };
    });
    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        warehouseId: invoice.warehouseId,
        paymentType: invoice.paymentType,
        branchId: invoice.branchId,
      },
      lines,
    };
  }

  // =========================================================
  // CREATE / UPDATE / DELETE (DRAFT only)
  // =========================================================
  async create(
    dto: CreateSalesReturnDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<SalesReturn> {
    const invoice = await this.loadPostedInvoice(dto.salesInvoiceId);
    await this.assertPeriod(dto.fiscalYearId, dto.accountingPeriodId);
    const items = await this.buildItems(invoice, dto.items);
    const totals = this.sumTotals(items);

    const salesReturn = this.repository.create({
      returnNumber: null,
      returnDate: dto.returnDate,
      salesInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      warehouseId: items[0]?.warehouseId ?? invoice.warehouseId ?? undefined,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: resolveWriteBranch(branchScope, invoice.branchId),
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      paymentType: invoice.paymentType,
      cashAccountId: invoice.cashAccountId,
      status: SalesReturnStatus.DRAFT,
      notes: dto.notes ?? null,
      createdBy: actorId ?? null,
      items,
      ...totals,
    });
    return this.repository.save(salesReturn);
  }

  async update(
    id: string,
    dto: UpdateSalesReturnDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<SalesReturn> {
    const salesReturn = await this.getEditableDraft(id, branchScope);
    if (dto.returnDate) salesReturn.returnDate = dto.returnDate;
    if (dto.fiscalYearId) salesReturn.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) salesReturn.accountingPeriodId = dto.accountingPeriodId;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope !== null) salesReturn.branchId = resolveWriteBranch(branchScope, salesReturn.branchId);
    if (dto.notes !== undefined) salesReturn.notes = dto.notes ?? null;
    await this.assertPeriod(salesReturn.fiscalYearId, salesReturn.accountingPeriodId);

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        const invoice = await this.loadPostedInvoice(salesReturn.salesInvoiceId, id);
        await manager.delete(SalesReturnItem, { salesReturnId: id });
        const items = await this.buildItems(invoice, dto.items, id);
        const totals = this.sumTotals(items);
        salesReturn.items = items;
        Object.assign(salesReturn, totals);
      }
      salesReturn.updatedBy = actorId ?? null;
      return manager.getRepository(SalesReturn).save(salesReturn);
    });
  }

  async remove(id: string, actorId?: string, branchScope: BranchScope = null): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.repository.update(id, { deletedBy: actorId ?? null });
    await this.repository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: SalesReturnQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<SalesReturnListItem>> {
    const qb = this.repository.createQueryBuilder('r');
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'r.branchId', branchScope);
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('r.returnNumber LIKE :s', { s: `%${query.search}%` }).orWhere('r.invoiceNumber LIKE :s', {
            s: `%${query.search}%`,
          });
        }),
      );
    }
    if (query.customerId) qb.andWhere('r.customerId = :cu', { cu: query.customerId });
    if (query.salesInvoiceId) qb.andWhere('r.salesInvoiceId = :si', { si: query.salesInvoiceId });
    if (query.fiscalYearId) qb.andWhere('r.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.status) qb.andWhere('r.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('r.returnDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('r.returnDate <= :dt', { dt: query.dateTo });
    qb.orderBy('r.returnDate', 'DESC').addOrderBy('r.createdAt', 'DESC').skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const names = await this.nameMap(this.customerRepository, items.map((i) => i.customerId));
    const rows: SalesReturnListItem[] = items.map((r) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      returnDate: r.returnDate,
      invoiceNumber: r.invoiceNumber,
      customerId: r.customerId,
      customerName: names.get(r.customerId) ?? null,
      totalAmount: r.totalAmount,
      status: r.status,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<SalesReturn> {
    const r = await this.repository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!r || !isWithinBranchScope(r.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على مردود المبيعات');
    }
    return r;
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const r = await this.findOne(id, branchScope);
    const [customer, warehouse, branch, fiscalYear, period, users] = await Promise.all([
      this.customerRepository.findOne({ where: { id: r.customerId } }),
      this.warehouseRepository.findOne({ where: { id: r.warehouseId } }),
      r.branchId ? this.branchRepository.findOne({ where: { id: r.branchId } }) : null,
      this.fiscalYearRepository.findOne({ where: { id: r.fiscalYearId } }),
      this.periodRepository.findOne({ where: { id: r.accountingPeriodId } }),
      this.userNames([r.createdBy, r.postedBy, r.reversedBy]),
    ]);
    return {
      ...r,
      customerName: customer?.name ?? null,
      warehouseName: warehouse?.name ?? null,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(r.createdBy ?? '') ?? null,
      postedByName: users.get(r.postedBy ?? '') ?? null,
      reversedByName: users.get(r.reversedBy ?? '') ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  /** Build return lines by prorating the original invoice line to the returned qty. */
  private async buildItems(
    invoice: SalesInvoice,
    dtos: SalesReturnItemDto[],
    excludeReturnId?: string,
  ): Promise<SalesReturnItem[]> {
    const itemById = new Map(invoice.items.map((i): [string, SalesInvoiceItem] => [i.id, i]));
    const alreadyReturned = await this.returnedQtyByItem(invoice.items.map((i) => i.id), excludeReturnId);
    const delivered = await this.deliveredInfoByItem(invoice.items.map((i) => i.id));
    const ships = await this.shipsViaDeliveryByItem(invoice.items);

    // Aggregate requested qty per invoice item to validate against remaining.
    const requested = new Map<string, number>();
    for (const d of dtos) requested.set(d.salesInvoiceItemId, round3((requested.get(d.salesInvoiceItemId) ?? 0) + d.quantity));

    return dtos.map((d, index) => {
      const src = itemById.get(d.salesInvoiceItemId);
      if (!src) throw new BadRequestException('أحد السطور لا يخص هذه الفاتورة');
      // Same rule as returnableItems(): stock goods → delivered qty; service /
      // manufacturing / non-inventory lines → the invoiced qty.
      const basis = ships.get(src.id) ? (delivered.get(src.id)?.qty ?? 0) : src.quantity;
      const remaining = round3(basis - (alreadyReturned.get(src.id) ?? 0));
      if (requested.get(src.id)! - remaining > 1e-6) {
        throw new BadRequestException(
          `الكمية المرتجعة من "${src.productName}" تتجاوز المُسلَّم المتبقي (${remaining})`,
        );
      }
      const soldQty = src.quantity || 1;
      const ratio = d.quantity / soldQty;

      const item = new SalesReturnItem();
      item.lineNumber = index + 1;
      item.salesInvoiceItemId = src.id;
      item.productId = src.productId;
      // Goods return to the warehouse the invoice line was sold from.
      const lineWarehouse = src.warehouseId ?? invoice.warehouseId;
      if (!lineWarehouse) {
        throw new BadRequestException(`لا يمكن تحديد مخزن لمرتجع الصنف "${src.productName}"`);
      }
      item.warehouseId = lineWarehouse;
      item.unitId = src.unitId;
      item.lineType = src.lineType;
      item.productCode = src.productCode;
      item.productName = src.productName;
      item.unitName = src.unitName;
      item.quantity = d.quantity;
      item.unitPrice = src.unitPrice;
      item.discountType = src.discountType;
      item.discountValue = src.discountValue;
      item.discountAmount = round2(src.discountAmount * ratio);
      item.netBeforeTax = round2(src.netBeforeTax * ratio);
      item.vatRate = src.vatRate;
      item.vatAmount = round2(src.vatAmount * ratio);
      item.lineTotal = round2(item.netBeforeTax + item.vatAmount);
      // Cost basis comes from the delivery note (COGS is booked at delivery, not
      // at invoicing). Manufacturing lines carry no inventory cost.
      item.costAtPost = ships.get(src.id) ? (delivered.get(src.id)?.unitCost ?? 0) : 0;
      return item;
    });
  }

  /**
   * Which invoice lines physically ship through a delivery note (and are
   * therefore returnable only once delivered): STOCK lines of inventory-tracked
   * products. Service, manufacturing and non-inventory lines are "delivered" at
   * invoicing, so their whole invoiced quantity is returnable.
   */
  private async shipsViaDeliveryByItem(items: SalesInvoiceItem[]): Promise<Map<string, boolean>> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = productIds.length
      ? await this.dataSource.getRepository(Product).find({
          where: { id: In(productIds) },
          select: { id: true, trackInventory: true },
          withDeleted: true,
        })
      : [];
    const tracksInventory = new Map<string, boolean>(products.map((p) => [p.id, p.trackInventory]));
    return new Map<string, boolean>(
      items.map((i) => [i.id, i.lineType === SalesLineType.STOCK && (tracksInventory.get(i.productId) ?? true)]),
    );
  }

  /** Net delivered qty + weighted-average unit cost per invoice item (POSTED deliveries only). */
  private async deliveredInfoByItem(
    invoiceItemIds: string[],
  ): Promise<Map<string, { qty: number; unitCost: number }>> {
    if (!invoiceItemIds.length) return new Map();
    const rows = await this.dataSource
      .getRepository(SalesDeliveryItem)
      .createQueryBuilder('di')
      .innerJoin('di.salesDelivery', 'd')
      .select('di.salesInvoiceItemId', 'itemId')
      .addSelect('COALESCE(SUM(di.quantity), 0)', 'qty')
      .addSelect('COALESCE(SUM(di.lineCost), 0)', 'cost')
      .where('di.salesInvoiceItemId IN (:...ids)', { ids: invoiceItemIds })
      .andWhere('d.status = :posted', { posted: SalesDeliveryStatus.POSTED })
      .groupBy('di.salesInvoiceItemId')
      .getRawMany<{ itemId: string; qty: string; cost: string }>();
    return new Map(
      rows.map((r): [string, { qty: number; unitCost: number }] => {
        const qty = Number(r.qty);
        const cost = Number(r.cost);
        return [r.itemId, { qty, unitCost: qty > 0 ? round2(cost / qty) : 0 }];
      }),
    );
  }

  private sumTotals(items: SalesReturnItem[]): {
    subtotal: number;
    discountAmount: number;
    taxableAmount: number;
    vatAmount: number;
    totalAmount: number;
  } {
    const subtotal = round2(items.reduce((s, i) => s + round2(i.quantity * i.unitPrice), 0));
    const discountAmount = round2(items.reduce((s, i) => s + i.discountAmount, 0));
    const taxableAmount = round2(items.reduce((s, i) => s + i.netBeforeTax, 0));
    const vatAmount = round2(items.reduce((s, i) => s + i.vatAmount, 0));
    const totalAmount = round2(taxableAmount + vatAmount);
    return { subtotal, discountAmount, taxableAmount, vatAmount, totalAmount };
  }

  private async returnedQtyByItem(
    invoiceItemIds: string[],
    excludeReturnId?: string,
  ): Promise<Map<string, number>> {
    if (!invoiceItemIds.length) return new Map();
    const qb = this.itemRepository
      .createQueryBuilder('ri')
      .innerJoin('ri.salesReturn', 'r')
      .select('ri.salesInvoiceItemId', 'itemId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .where('ri.salesInvoiceItemId IN (:...ids)', { ids: invoiceItemIds })
      .andWhere('r.status != :reversed', { reversed: SalesReturnStatus.REVERSED })
      .groupBy('ri.salesInvoiceItemId');
    if (excludeReturnId) qb.andWhere('r.id != :ex', { ex: excludeReturnId });
    const rows = await qb.getRawMany<{ itemId: string; qty: string }>();
    return new Map(rows.map((r): [string, number] => [r.itemId, Number(r.qty)]));
  }

  private async loadPostedInvoice(invoiceId: string, _excludeReturnId?: string): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice) throw new NotFoundException('الفاتورة الأصلية غير موجودة');
    if (invoice.status !== SalesInvoiceStatus.POSTED) {
      throw new BadRequestException('لا يمكن إنشاء مردود إلا من فاتورة مُرحّلة');
    }
    return invoice;
  }

  private async getEditableDraft(id: string, branchScope: BranchScope = null): Promise<SalesReturn> {
    const r = await this.findOne(id, branchScope);
    if (r.status !== SalesReturnStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف مردود مُرحّل — استخدم العكس');
    }
    return r;
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

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
