import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from './entities/purchase-invoice-item.entity';
import { LandedAllocation, PurchaseLandedExpense, allocateLandedCosts } from './landed-cost.util';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import {
  PurchaseInvoiceStatus,
  PurchasePaymentType,
} from './enums/purchase-invoice.enum';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from './dto/update-purchase-invoice.dto';
import { PurchaseInvoiceQueryDto } from './dto/purchase-invoice-query.dto';
import { PurchaseInvoiceItemDto } from './dto/purchase-invoice-item.dto';
import {
  computeInvoice,
  round2,
  SalesLineInput,
} from '../sales-invoice/sales-math';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { ProductImage } from '../product/entities/product-image.entity';
import { paginate } from '../../common/utils/pagination.util';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { MANUFACTURING_ORDER_STATUS_LABELS, ManufacturingOrderStatus } from '../manufacturing/enums/manufacturing.enum';
import { DIRECT_MATERIAL_OPEN_STATUSES, DIRECT_MATERIAL_TYPES } from '../manufacturing/direct-material.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface PurchaseInvoiceListItem {
  id: string;
  invoiceNumber: string | null;
  supplierInvoiceNumber: string | null;
  invoiceDate: string;
  supplierId: string;
  supplierName: string | null;
  warehouseId: string;
  warehouseName: string | null;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
  remainingAmount: number;
  status: PurchaseInvoiceStatus;
}

/** A product row for the purchase-invoice picker (image/cost/on-hand aware). */
export interface PurchaseProductOption {
  id: string;
  code: string;
  name: string;
  unitId: string | null;
  unitName: string | null;
  costPrice: number;
  imageUrl: string | null;
  onHand: number;
  /** Weighted-average cost in the chosen warehouse (0 when it holds none yet). */
  avgCost: number;
  /** raw_material / semi_finished can be bought straight onto a manufacturing order. */
  productType: string;
}

/** An order a purchase line can be bought straight onto (new / in progress). */
export interface DirectMaterialOrderOption {
  id: string;
  orderNumber: string | null;
  status: string;
  statusLabel: string;
  productName: string | null;
  quantity: number;
  customerName: string | null;
  sourceNumber: string | null;
  material: string | null;
  color: string | null;
  branchId: string | null;
}

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepository: Repository<PurchaseInvoice>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
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
    @InjectRepository(WarehouseStock)
    private readonly stockRepository: Repository<WarehouseStock>,
    @InjectRepository(ProductImage)
    private readonly imageRepository: Repository<ProductImage>,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // CREATE / UPDATE / DELETE (DRAFT only)
  // =========================================================
  async create(
    dto: CreatePurchaseInvoiceDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<PurchaseInvoice> {
    await this.assertHeaderRefs(dto);
    const items = await this.buildItems(dto.items, dto.warehouseId, branchScope);
    const { totals } = computeInvoice(this.toLineInputs(dto.items));
    const landedExpenses = await this.applyLandedExpenses(dto.landedExpenses ?? [], items);

    const invoice = this.invoiceRepository.create({
      invoiceNumber: null,
      supplierInvoiceNumber: dto.supplierInvoiceNumber ?? null,
      invoiceDate: dto.invoiceDate,
      supplierId: dto.supplierId,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: resolveWriteBranch(branchScope, dto.branchId),
      warehouseId: dto.warehouseId,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      paymentType: dto.paymentType ?? PurchasePaymentType.CREDIT,
      cashAccountId: dto.cashAccountId ?? null,
      notes: dto.notes ?? null,
      status: PurchaseInvoiceStatus.DRAFT,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      paidAmount: 0,
      remainingAmount: totals.totalAmount,
      landedExpenses,
      createdBy: actorId ?? null,
      items,
    });
    return this.invoiceRepository.save(invoice);
  }

  async update(
    id: string,
    dto: UpdatePurchaseInvoiceDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<PurchaseInvoice> {
    const invoice = await this.getEditableDraft(id, branchScope);

    if (dto.supplierId) invoice.supplierId = dto.supplierId;
    if (dto.invoiceDate) invoice.invoiceDate = dto.invoiceDate;
    if (dto.supplierInvoiceNumber !== undefined) {
      invoice.supplierInvoiceNumber = dto.supplierInvoiceNumber ?? null;
    }
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope !== null) invoice.branchId = resolveWriteBranch(branchScope, invoice.branchId);
    else if (dto.branchId !== undefined) invoice.branchId = dto.branchId ?? null;
    if (dto.warehouseId) invoice.warehouseId = dto.warehouseId;
    if (dto.fiscalYearId) invoice.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) invoice.accountingPeriodId = dto.accountingPeriodId;
    if (dto.paymentType) invoice.paymentType = dto.paymentType;
    if (dto.cashAccountId !== undefined) invoice.cashAccountId = dto.cashAccountId ?? null;
    if (dto.notes !== undefined) invoice.notes = dto.notes ?? null;
    await this.assertHeaderRefs({
      supplierId: invoice.supplierId,
      warehouseId: invoice.warehouseId,
      fiscalYearId: invoice.fiscalYearId,
      accountingPeriodId: invoice.accountingPeriodId,
    });

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        await manager.delete(PurchaseInvoiceItem, { purchaseInvoiceId: id });
        const items = await this.buildItems(dto.items, invoice.warehouseId, branchScope);
        const { totals } = computeInvoice(this.toLineInputs(dto.items));
        invoice.subtotal = totals.subtotal;
        invoice.discountAmount = totals.discountAmount;
        invoice.taxableAmount = totals.taxableAmount;
        invoice.vatAmount = totals.vatAmount;
        invoice.totalAmount = totals.totalAmount;
        invoice.remainingAmount = totals.totalAmount - invoice.paidAmount;
        invoice.items = items;
      }
      // Expenses are re-spread whenever the lines or the expenses change.
      if (dto.items || dto.landedExpenses !== undefined) {
        const expenses = dto.landedExpenses ?? invoice.landedExpenses ?? [];
        invoice.landedExpenses = await this.applyLandedExpenses(expenses, invoice.items ?? []);
      }
      invoice.updatedBy = actorId ?? null;
      return manager.getRepository(PurchaseInvoice).save(invoice);
    });
  }

  async remove(id: string, actorId?: string, branchScope: BranchScope = null): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.invoiceRepository.update(id, { deletedBy: actorId ?? null });
    await this.invoiceRepository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  /** Every list filter in one place — shared by `findAll` and `summary` so the cards always match the table. */
  private applyListFilters(
    qb: ReturnType<Repository<PurchaseInvoice>['createQueryBuilder']>,
    query: PurchaseInvoiceQueryDto,
    branchScope: BranchScope,
  ): void {
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'pi.branchId', branchScope);

    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('pi.invoiceNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('pi.supplierInvoiceNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('pi.notes LIKE :s', { s: `%${query.search}%` })
            // supplier name / code / mobile
            .orWhere('EXISTS (SELECT 1 FROM suppliers ss WHERE ss.id = pi.supplier_id AND (ss.name LIKE :s OR ss.code LIKE :s OR ss.mobile LIKE :s))', { s: `%${query.search}%` });
        }),
      );
    }
    if (query.fiscalYearId) qb.andWhere('pi.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.accountingPeriodId) qb.andWhere('pi.accountingPeriodId = :ap', { ap: query.accountingPeriodId });
    if (query.supplierId) qb.andWhere('pi.supplierId = :su', { su: query.supplierId });
    if (query.branchId) qb.andWhere('pi.branchId = :br', { br: query.branchId });
    if (query.warehouseId) qb.andWhere('pi.warehouseId = :wh', { wh: query.warehouseId });
    if (query.status) qb.andWhere('pi.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('pi.invoiceDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('pi.invoiceDate <= :dt', { dt: query.dateTo });
  }

  async summary(query: PurchaseInvoiceQueryDto, branchScope: BranchScope = null) {
    const qb = this.invoiceRepository.createQueryBuilder('pi');
    this.applyListFilters(qb, query, branchScope);
    const basis = query.status ?? PurchaseInvoiceStatus.POSTED;
    const raw = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect(`SUM(CASE WHEN pi.status = 'draft' THEN 1 ELSE 0 END)`, 'drafts')
      .addSelect(`SUM(CASE WHEN pi.status = 'posted' THEN 1 ELSE 0 END)`, 'posted')
      .addSelect(`SUM(CASE WHEN pi.status IN ('reversed','cancelled') THEN 1 ELSE 0 END)`, 'voided')
      .addSelect(`COALESCE(SUM(CASE WHEN pi.status = :basis THEN pi.taxableAmount ELSE 0 END), 0)`, 'taxable')
      .addSelect(`COALESCE(SUM(CASE WHEN pi.status = :basis THEN pi.vatAmount ELSE 0 END), 0)`, 'vat')
      .addSelect(`COALESCE(SUM(CASE WHEN pi.status = :basis THEN pi.totalAmount ELSE 0 END), 0)`, 'total')
      .addSelect(`COALESCE(SUM(CASE WHEN pi.status = :basis THEN pi.paidAmount ELSE 0 END), 0)`, 'paid')
      .addSelect(`COALESCE(SUM(CASE WHEN pi.status = :basis THEN pi.remainingAmount ELSE 0 END), 0)`, 'remaining')
      .addSelect(`SUM(CASE WHEN pi.status = :basis AND pi.remainingAmount > 0.004 THEN 1 ELSE 0 END)`, 'unpaid')
      .setParameter('basis', basis)
      .getRawOne<Record<string, string | null>>();
    const n = (k: string) => Number(raw?.[k] ?? 0) || 0;
    const total = round2(n('total'));
    const basisCount = basis === PurchaseInvoiceStatus.POSTED ? n('posted') : n('cnt');
    return {
      basis,
      count: n('cnt'),
      draftCount: n('drafts'),
      postedCount: n('posted'),
      voidedCount: n('voided'),
      unpaidCount: n('unpaid'),
      taxableAmount: round2(n('taxable')),
      vatAmount: round2(n('vat')),
      totalAmount: total,
      paidAmount: round2(n('paid')),
      remainingAmount: round2(n('remaining')),
      averageInvoice: basisCount ? round2(total / basisCount) : 0,
    };
  }

  async findAll(
    query: PurchaseInvoiceQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<PurchaseInvoiceListItem>> {
    const qb = this.invoiceRepository.createQueryBuilder('pi');
    this.applyListFilters(qb, query, branchScope);

    qb.orderBy('pi.invoiceDate', 'DESC').addOrderBy('pi.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();

    const supplierName = await this.nameMap(
      this.supplierRepository,
      items.map((i) => i.supplierId),
    );
    const warehouseName = await this.nameMap(
      this.warehouseRepository,
      items.map((i) => i.warehouseId),
    );

    const rows: PurchaseInvoiceListItem[] = items.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      supplierInvoiceNumber: i.supplierInvoiceNumber,
      invoiceDate: i.invoiceDate,
      supplierId: i.supplierId,
      supplierName: supplierName.get(i.supplierId) ?? null,
      warehouseId: i.warehouseId,
      warehouseName: warehouseName.get(i.warehouseId) ?? null,
      taxableAmount: i.taxableAmount,
      vatAmount: i.vatAmount,
      totalAmount: i.totalAmount,
      remainingAmount: i.remainingAmount,
      status: i.status,
    }));

    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<PurchaseInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice || !isWithinBranchScope(invoice.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على فاتورة المشتريات');
    }
    return invoice;
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const invoice = await this.findOne(id, branchScope);
    const [supplier, warehouse, branch, fiscalYear, period, users] =
      await Promise.all([
        this.supplierRepository.findOne({ where: { id: invoice.supplierId } }),
        this.warehouseRepository.findOne({ where: { id: invoice.warehouseId } }),
        invoice.branchId
          ? this.branchRepository.findOne({ where: { id: invoice.branchId } })
          : null,
        this.fiscalYearRepository.findOne({ where: { id: invoice.fiscalYearId } }),
        this.periodRepository.findOne({ where: { id: invoice.accountingPeriodId } }),
        this.userNames([invoice.createdBy, invoice.postedBy, invoice.reversedBy]),
      ]);

    const orderIds = [...new Set((invoice.items ?? []).map((i) => i.manufacturingOrderId).filter((v): v is string => !!v))];
    const orders = orderIds.length ? await this.dataSource.getRepository(ManufacturingOrder).find({ where: { id: In(orderIds) }, withDeleted: true }) : [];
    const orderById = new Map(orders.map((o): [string, ManufacturingOrder] => [o.id, o]));
    const releasedIds = [...new Set((invoice.items ?? []).map((i) => i.releasedWarehouseId).filter((v): v is string => !!v))];
    const releasedWh = releasedIds.length ? await this.warehouseRepository.find({ where: { id: In(releasedIds) } }) : [];
    const whName = new Map(releasedWh.map((w): [string, string] => [w.id, w.name]));
    const items = (invoice.items ?? []).map((i) => {
      const o = i.manufacturingOrderId ? orderById.get(i.manufacturingOrderId) : undefined;
      return {
        ...i,
        manufacturingOrderNumber: o?.orderNumber ?? null,
        manufacturingOrderStatus: o?.status ?? null,
        manufacturingProductName: o?.productName ?? null,
        manufacturingCustomerName: o?.customerName ?? null,
        releasedWarehouseName: i.releasedWarehouseId ? whName.get(i.releasedWarehouseId) ?? null : null,
      };
    });
    // Landed expenses with the treasury / bank they are paid from (by name).
    const expenses = invoice.landedExpenses ?? [];
    const tIds = expenses.map((e) => e.treasuryId).filter((v): v is string => !!v);
    const bIds = expenses.map((e) => e.bankAccountId).filter((v): v is string => !!v);
    const [ts, bs] = await Promise.all([
      tIds.length ? this.dataSource.getRepository(Treasury).find({ where: { id: In(tIds) }, withDeleted: true }) : [],
      bIds.length ? this.dataSource.getRepository(BankAccount).find({ where: { id: In(bIds) }, withDeleted: true }) : [],
    ]);
    const fromName = new Map<string, string>([
      ...ts.map((x): [string, string] => [x.id, x.name]),
      ...bs.map((b): [string, string] => [b.id, b.accountName ? `${b.bankName} — ${b.accountName}` : b.bankName]),
    ]);
    return {
      ...invoice,
      items,
      landedExpenses: expenses.length
        ? expenses.map((e) => ({ ...e, paidFromName: fromName.get(e.treasuryId ?? e.bankAccountId ?? '') ?? null }))
        : null,
      supplierName: supplier?.name ?? null,
      warehouseName: warehouse?.name ?? null,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(invoice.createdBy ?? '') ?? null,
      postedByName: users.get(invoice.postedBy ?? '') ?? null,
      reversedByName: users.get(invoice.reversedBy ?? '') ?? null,
    };
  }

  /** Products for the purchase picker with on-hand qty in the given warehouse. */
  async purchaseProducts(warehouseId?: string): Promise<PurchaseProductOption[]> {
    const products = await this.productRepository.find({
      where: { isActive: true },
      relations: { unit: true },
      order: { code: 'ASC' },
    });
    if (!products.length) return [];

    const ids = products.map((p) => p.id);
    const [stocks, images] = await Promise.all([
      warehouseId
        ? this.stockRepository.find({ where: { warehouseId, productId: In(ids) } })
        : [],
      this.imageRepository.find({ where: { productId: In(ids), isPrimary: true } }),
    ]);
    const qtyByProduct = new Map(stocks.map((s): [string, number] => [s.productId, s.quantity]));
    const avgByProduct = new Map(stocks.map((s): [string, number] => [s.productId, Number(s.avgCost) || 0]));
    const imgByProduct = new Map(images.map((i): [string, string] => [i.productId, i.url]));

    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      unitId: p.unitId,
      unitName: p.unit?.name ?? null,
      costPrice: p.costPrice,
      imageUrl: imgByProduct.get(p.id) ?? null,
      onHand: qtyByProduct.get(p.id) ?? 0,
      avgCost: avgByProduct.get(p.id) ?? 0,
      productType: p.productType,
    }));
  }

  /** Orders a purchase line can be bought straight onto: not yet produced, in the user's branches. */
  async directMaterialOrders(branchScope: BranchScope = null): Promise<DirectMaterialOrderOption[]> {
    const qb = this.dataSource
      .getRepository(ManufacturingOrder)
      .createQueryBuilder('mo')
      .where('mo.status IN (:...open)', { open: DIRECT_MATERIAL_OPEN_STATUSES })
      .orderBy('mo.orderDate', 'DESC')
      .addOrderBy('mo.orderNumber', 'DESC');
    applyBranchScope(qb, 'mo.branchId', branchScope);
    const rows = await qb.getMany();
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: MANUFACTURING_ORDER_STATUS_LABELS[o.status] ?? o.status,
      productName: o.productName,
      quantity: Number(o.quantity) || 0,
      customerName: o.customerName,
      sourceNumber: o.sourceNumber,
      material: o.material,
      color: o.color,
      branchId: o.branchId,
    }));
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private toLineInputs(items: PurchaseInvoiceItemDto[]): SalesLineInput[] {
    return items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountType: (i.discountType ?? 'fixed') as SalesLineInput['discountType'],
      discountValue: i.discountValue ?? 0,
      vatRate: i.vatRate ?? 0,
    }));
  }

  /** Build persisted item rows with financial + product/unit snapshots. */
  private async buildItems(
    itemsDto: PurchaseInvoiceItemDto[],
    warehouseId: string,
    branchScope: BranchScope = null,
  ): Promise<PurchaseInvoiceItem[]> {
    // Lines bought straight onto a manufacturing order: the order must exist, be in the
    // user's branches and not be produced yet (re-checked when the invoice is posted).
    const orderIds = [...new Set(itemsDto.map((i) => i.manufacturingOrderId).filter((v): v is string => !!v))];
    const orders = orderIds.length ? await this.dataSource.getRepository(ManufacturingOrder).find({ where: { id: In(orderIds) } }) : [];
    const orderById = new Map(orders.map((o): [string, ManufacturingOrder] => [o.id, o]));
    const productIds = [...new Set(itemsDto.map((i) => i.productId))];
    const products = await this.productRepository.find({
      where: { id: In(productIds) },
    });
    const productById = new Map(products.map((p): [string, Product] => [p.id, p]));

    const unitIds = [
      ...new Set(
        itemsDto
          .map((i, idx) => i.unitId ?? productById.get(itemsDto[idx].productId)?.unitId)
          .filter((v): v is string => !!v),
      ),
    ];
    const units = unitIds.length
      ? await this.unitRepository.find({ where: { id: In(unitIds) } })
      : [];
    const unitById = new Map(units.map((u): [string, Unit] => [u.id, u]));

    const computed = computeInvoice(this.toLineInputs(itemsDto)).lines;

    return itemsDto.map((dto, index) => {
      const product = productById.get(dto.productId);
      if (!product) {
        throw new BadRequestException('أحد المنتجات المختارة غير موجود');
      }
      const unitId = dto.unitId ?? product.unitId;
      const line = computed[index];

      const item = new PurchaseInvoiceItem();
      item.lineNumber = index + 1;
      item.productId = dto.productId;
      item.warehouseId = warehouseId;
      item.unitId = unitId ?? null;
      item.productCode = product.code;
      item.productName = product.name;
      item.unitName = unitId ? unitById.get(unitId)?.name ?? null : null;
      item.quantity = dto.quantity;
      item.unitPrice = dto.unitPrice;
      item.discountType = (dto.discountType ?? 'fixed') as PurchaseInvoiceItem['discountType'];
      item.discountValue = dto.discountValue ?? 0;
      item.discountAmount = line.discountAmount;
      item.netBeforeTax = line.netBeforeTax;
      item.vatRate = dto.vatRate ?? 0;
      item.vatAmount = line.vatAmount;
      item.lineTotal = line.lineTotal;
      item.unitCostAtPost = 0;
      item.landedCost = 0;
      item.manufacturingOrderId = null;
      item.directDescription = null;
      item.releasedWarehouseId = null;
      item.releasedAt = null;
      if (dto.manufacturingOrderId) {
        if (!DIRECT_MATERIAL_TYPES.includes(product.productType)) {
          throw new BadRequestException(`«${product.name}» ليس مادة خام أو نصف مصنّع — الشراء المباشر على أمر تصنيع للخامات فقط`);
        }
        const order = orderById.get(dto.manufacturingOrderId);
        if (!order || !isWithinBranchScope(order.branchId, branchScope)) throw new BadRequestException('أمر التصنيع المختار غير موجود');
        if (!DIRECT_MATERIAL_OPEN_STATUSES.includes(order.status)) {
          throw new BadRequestException(
            `أمر التصنيع ${order.orderNumber ?? ''} ${MANUFACTURING_ORDER_STATUS_LABELS[order.status as ManufacturingOrderStatus] ?? order.status} — الشراء المباشر على الأمر قبل تنفيذ الإنتاج فقط`,
          );
        }
        item.manufacturingOrderId = order.id;
        item.directDescription = dto.directDescription?.trim() || null;
      }
      return item;
    });
  }

  /**
   * Check the landed expenses (amount, target line, a treasury OR a bank) and write
   * each line's share into `item.landedCost`. Returns what is stored on the invoice
   * (null when there are none).
   */
  private async applyLandedExpenses(
    expenses: PurchaseLandedExpense[],
    items: PurchaseInvoiceItem[],
  ): Promise<PurchaseLandedExpense[] | null> {
    const lineNumbers = new Set(items.map((i) => i.lineNumber));
    const clean: PurchaseLandedExpense[] = [];
    for (const e of expenses) {
      const description = (e.description ?? '').trim();
      const amount = Math.round((Number(e.amount) || 0) * 100) / 100;
      if (!description) throw new BadRequestException('بيان المصروف مطلوب');
      if (amount <= 0) throw new BadRequestException(`مبلغ المصروف «${description}» يجب أن يكون أكبر من صفر`);
      if (!!e.treasuryId === !!e.bankAccountId) {
        throw new BadRequestException(`اختر خزنة أو حساباً بنكياً يُصرف منه المصروف «${description}»`);
      }
      if (e.treasuryId) {
        const t = await this.dataSource.getRepository(Treasury).findOne({ where: { id: e.treasuryId } });
        if (!t || !t.isActive) throw new BadRequestException(`الخزنة المختارة للمصروف «${description}» غير موجودة أو غير نشطة`);
      } else {
        const b = await this.dataSource.getRepository(BankAccount).findOne({ where: { id: e.bankAccountId! } });
        if (!b || !b.isActive) throw new BadRequestException(`الحساب البنكي المختار للمصروف «${description}» غير موجود أو غير نشط`);
      }
      const onLine = e.allocation === LandedAllocation.LINE;
      if (onLine && !lineNumbers.has(Number(e.targetLineNumber))) {
        throw new BadRequestException(`الصنف المختار لتحميل المصروف «${description}» غير موجود في الفاتورة`);
      }
      clean.push({
        description,
        amount,
        allocation: e.allocation,
        targetLineNumber: onLine ? Number(e.targetLineNumber) : null,
        treasuryId: e.treasuryId ?? null,
        bankAccountId: e.treasuryId ? null : e.bankAccountId ?? null,
        voucherId: null,
        voucherNumber: null,
      });
    }
    const shares = allocateLandedCosts(items, clean);
    for (const item of items) item.landedCost = shares.get(item.lineNumber) ?? 0;
    return clean.length ? clean : null;
  }

  private async getEditableDraft(id: string, branchScope: BranchScope = null): Promise<PurchaseInvoice> {
    const invoice = await this.findOne(id, branchScope);
    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن تعديل أو حذف فاتورة مُرحّلة — استخدم العكس أو المردود',
      );
    }
    return invoice;
  }

  private async assertHeaderRefs(dto: {
    supplierId: string;
    warehouseId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
  }): Promise<void> {
    const supplier = await this.supplierRepository.findOne({
      where: { id: dto.supplierId },
    });
    if (!supplier) throw new NotFoundException('المورّد غير موجود');
    if (!supplier.isActive) throw new BadRequestException('المورّد غير نشط');

    const warehouse = await this.warehouseRepository.findOne({
      where: { id: dto.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');

    const period = await this.periodRepository.findOne({
      where: { id: dto.accountingPeriodId },
    });
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

  private async userNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await this.userRepository.find({ where: { id: In(unique) } });
    return new Map(users.map((u): [string, string] => [u.id, u.fullName]));
  }
}
