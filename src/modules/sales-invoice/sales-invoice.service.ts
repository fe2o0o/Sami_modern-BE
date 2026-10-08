import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import {
  BranchScope,
  applyBranchScope,
  isWithinBranchScope,
  resolveWriteBranch,
} from '../../common/utils/branch-scope.util';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceItem } from './entities/sales-invoice-item.entity';
import { SalesInvoiceItemComponent } from './entities/sales-invoice-item-component.entity';
import { SalesInvoiceCommission } from './entities/sales-invoice-commission.entity';
import {
  SalesCommissionType,
  SalesInvoiceStatus,
  SalesLineType,
  SalesPaymentType,
} from './enums/sales-invoice.enum';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';
import { SalesInvoiceQueryDto } from './dto/sales-invoice-query.dto';
import { SalesInvoiceItemDto } from './dto/sales-invoice-item.dto';
import { SalesInvoiceCommissionDto } from './dto/sales-invoice-commission.dto';
import { Employee } from '../employee/entities/employee.entity';
import { computeInvoice, round2, SalesLineInput } from './sales-math';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { ProductImage } from '../product/entities/product-image.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface SalesInvoiceListItem {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  customerId: string;
  customerName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
  remainingAmount: number;
  status: SalesInvoiceStatus;
}

/** A product row for the invoice product picker (image/price/available aware). */
export interface SaleProductOption {
  id: string;
  code: string;
  name: string;
  productType: string;
  unitId: string | null;
  unitName: string | null;
  sellingPrice: number;
  imageUrl: string | null;
  available: number;
}

@Injectable()
export class SalesInvoiceService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepository: Repository<SalesInvoice>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
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
    dto: CreateSalesInvoiceDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<SalesInvoice> {
    // Header warehouse is a representative = the first stock line's (null if the
    // invoice is entirely made-to-order). Each line carries its own warehouse.
    const headerWarehouseId = dto.warehouseId ?? this.pickHeaderWarehouse(dto.items);
    await this.assertHeaderRefs({ ...dto, warehouseId: headerWarehouseId });
    const items = await this.buildItems(dto.items, headerWarehouseId);
    const { totals } = computeInvoice(this.toLineInputs(dto.items));
    const commissions = await this.buildCommissions(dto.commissions ?? [], totals.taxableAmount);
    const commissionTotal = round2(commissions.reduce((s, c) => s + c.amount, 0));

    const invoice = this.invoiceRepository.create({
      invoiceNumber: null,
      invoiceDate: dto.invoiceDate,
      customerId: dto.customerId,
      // A branch-restricted user picks among their branches (validated); one → auto.
      branchId: resolveWriteBranch(branchScope, dto.branchId),
      warehouseId: headerWarehouseId,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      paymentType: dto.paymentType ?? SalesPaymentType.CREDIT,
      cashAccountId: dto.cashAccountId ?? null,
      notes: dto.notes ?? null,
      status: SalesInvoiceStatus.DRAFT,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      paidAmount: 0,
      remainingAmount: totals.totalAmount,
      commissionTotal,
      createdBy: actorId ?? null,
      items,
      commissions,
    });
    return this.invoiceRepository.save(invoice);
  }

  async update(
    id: string,
    dto: UpdateSalesInvoiceDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<SalesInvoice> {
    const invoice = await this.getEditableDraft(id, branchScope);

    if (dto.customerId) invoice.customerId = dto.customerId;
    if (dto.invoiceDate) invoice.invoiceDate = dto.invoiceDate;
    // A branch-restricted user can only keep/move the document within their branches.
    if (branchScope !== null) {
      invoice.branchId = resolveWriteBranch(branchScope, dto.branchId ?? invoice.branchId);
    } else if (dto.branchId !== undefined) {
      invoice.branchId = dto.branchId ?? null;
    }
    // When the lines change, re-derive the representative header warehouse from them.
    if (dto.items) {
      invoice.warehouseId = dto.warehouseId ?? this.pickHeaderWarehouse(dto.items);
    } else if (dto.warehouseId) {
      invoice.warehouseId = dto.warehouseId;
    }
    if (dto.fiscalYearId) invoice.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) invoice.accountingPeriodId = dto.accountingPeriodId;
    if (dto.paymentType) invoice.paymentType = dto.paymentType;
    if (dto.cashAccountId !== undefined) invoice.cashAccountId = dto.cashAccountId ?? null;
    if (dto.notes !== undefined) invoice.notes = dto.notes ?? null;
    await this.assertHeaderRefs({
      customerId: invoice.customerId,
      warehouseId: invoice.warehouseId,
      fiscalYearId: invoice.fiscalYearId,
      accountingPeriodId: invoice.accountingPeriodId,
    });

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        // Remove each old line's per-order BOM first (no DB FK cascade), then the lines.
        const oldItems = await manager.find(SalesInvoiceItem, {
          where: { salesInvoiceId: id },
          select: { id: true },
        });
        if (oldItems.length) {
          await manager.delete(SalesInvoiceItemComponent, {
            salesInvoiceItemId: In(oldItems.map((i) => i.id)),
          });
        }
        await manager.delete(SalesInvoiceItem, { salesInvoiceId: id });
        const items = await this.buildItems(dto.items, invoice.warehouseId);
        const { totals } = computeInvoice(this.toLineInputs(dto.items));
        invoice.subtotal = totals.subtotal;
        invoice.discountAmount = totals.discountAmount;
        invoice.taxableAmount = totals.taxableAmount;
        invoice.vatAmount = totals.vatAmount;
        invoice.totalAmount = totals.totalAmount;
        invoice.remainingAmount = totals.totalAmount - invoice.paidAmount;
        invoice.items = items;
      }
      if (dto.commissions !== undefined) {
        await manager.delete(SalesInvoiceCommission, { salesInvoiceId: id });
        const commissions = await this.buildCommissions(dto.commissions, invoice.taxableAmount);
        invoice.commissions = commissions;
        invoice.commissionTotal = round2(commissions.reduce((s, c) => s + c.amount, 0));
      }
      invoice.updatedBy = actorId ?? null;
      return manager.getRepository(SalesInvoice).save(invoice);
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
  async findAll(
    query: SalesInvoiceQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<SalesInvoiceListItem>> {
    const qb = this.invoiceRepository.createQueryBuilder('si');
    this.applyListFilters(qb, query, branchScope);

    qb.orderBy('si.invoiceDate', 'DESC').addOrderBy('si.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();

    const customerName = await this.nameMap(
      this.customerRepository,
      items.map((i) => i.customerId),
    );
    const warehouseName = await this.nameMap(
      this.warehouseRepository,
      items.map((i) => i.warehouseId).filter((v): v is string => !!v),
    );

    const rows: SalesInvoiceListItem[] = items.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      customerId: i.customerId,
      customerName: customerName.get(i.customerId) ?? null,
      warehouseId: i.warehouseId,
      warehouseName: i.warehouseId ? warehouseName.get(i.warehouseId) ?? null : null,
      taxableAmount: i.taxableAmount,
      vatAmount: i.vatAmount,
      totalAmount: i.totalAmount,
      remainingAmount: i.remainingAmount,
      status: i.status,
    }));

    return paginate(rows, total, query.page, query.perPage);
  }

  /** The list's filters, shared by the page query and the summary cards. */
  private applyListFilters(
    qb: ReturnType<Repository<SalesInvoice>['createQueryBuilder']>,
    query: SalesInvoiceQueryDto,
    branchScope: BranchScope,
  ): void {
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'si.branchId', branchScope);
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('si.invoiceNumber LIKE :s', { s: `%${query.search}%` }).orWhere(
            'si.notes LIKE :s',
            { s: `%${query.search}%` },
          );
        }),
      );
    }
    if (query.fiscalYearId) qb.andWhere('si.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.accountingPeriodId) qb.andWhere('si.accountingPeriodId = :ap', { ap: query.accountingPeriodId });
    if (query.customerId) qb.andWhere('si.customerId = :cu', { cu: query.customerId });
    if (query.branchId) qb.andWhere('si.branchId = :br', { br: query.branchId });
    if (query.warehouseId) qb.andWhere('si.warehouseId = :wh', { wh: query.warehouseId });
    if (query.status) qb.andWhere('si.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('si.invoiceDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('si.invoiceDate <= :dt', { dt: query.dateTo });
  }

  /**
   * Analysis cards for the invoices list, over EXACTLY the list's filters.
   * Money totals count posted invoices only (drafts are not sales yet), unless
   * a status filter is applied — then they total that status.
   */
  async summary(query: SalesInvoiceQueryDto, branchScope: BranchScope = null) {
    const qb = this.invoiceRepository.createQueryBuilder('si');
    this.applyListFilters(qb, query, branchScope);
    const basis = query.status ?? SalesInvoiceStatus.POSTED;
    const raw = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect(`SUM(CASE WHEN si.status = 'draft' THEN 1 ELSE 0 END)`, 'drafts')
      .addSelect(`SUM(CASE WHEN si.status = 'posted' THEN 1 ELSE 0 END)`, 'posted')
      .addSelect(`SUM(CASE WHEN si.status IN ('reversed','cancelled') THEN 1 ELSE 0 END)`, 'voided')
      .addSelect(`COALESCE(SUM(CASE WHEN si.status = :basis THEN si.taxableAmount ELSE 0 END), 0)`, 'taxable')
      .addSelect(`COALESCE(SUM(CASE WHEN si.status = :basis THEN si.vatAmount ELSE 0 END), 0)`, 'vat')
      .addSelect(`COALESCE(SUM(CASE WHEN si.status = :basis THEN si.totalAmount ELSE 0 END), 0)`, 'total')
      .addSelect(`COALESCE(SUM(CASE WHEN si.status = :basis THEN si.paidAmount ELSE 0 END), 0)`, 'paid')
      .addSelect(`COALESCE(SUM(CASE WHEN si.status = :basis THEN si.remainingAmount ELSE 0 END), 0)`, 'remaining')
      .addSelect(`SUM(CASE WHEN si.status = :basis AND si.remainingAmount > 0.004 THEN 1 ELSE 0 END)`, 'unpaid')
      .setParameter('basis', basis)
      .getRawOne<Record<string, string | null>>();
    const n = (k: string) => Number(raw?.[k] ?? 0) || 0;
    const total = round2(n('total'));
    const basisCount = basis === SalesInvoiceStatus.POSTED ? n('posted') : n('cnt');
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

  /** Invoice lines cancelled from the delivery order, with the credit note that covered them. */
  private async cancelledLines(invoice: SalesInvoice): Promise<
    { salesInvoiceItemId: string; quantity: number; amount: number; returnNumber: string | null }[]
  > {
    const ids = (invoice.items ?? []).map((i) => i.id);
    if (!ids.length) return [];
    const rows = (await this.dataSource.query(
      `SELECT di.sales_invoice_item_id AS itemId, di.cancelled_quantity AS qty, r.return_number AS returnNumber,
              COALESCE((SELECT SUM(ri.line_total) FROM sales_return_items ri
                        WHERE ri.sales_return_id = r.id AND ri.sales_invoice_item_id = di.sales_invoice_item_id AND ri.deleted_at IS NULL), 0) AS amount
         FROM sales_delivery_items di
         JOIN sales_returns r ON r.id = di.cancel_return_id AND r.deleted_at IS NULL AND r.status = 'posted'
        WHERE di.deleted_at IS NULL AND di.cancelled_quantity > 0 AND di.sales_invoice_item_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )) as Array<{ itemId: string; qty: string; returnNumber: string | null; amount: string }>;
    return rows.map((r) => ({
      salesInvoiceItemId: r.itemId,
      quantity: Number(r.qty) || 0,
      amount: round2(Number(r.amount) || 0),
      returnNumber: r.returnNumber,
    }));
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: { items: { components: true }, commissions: true },
      order: { items: { lineNumber: 'ASC' }, commissions: { lineNumber: 'ASC' } },
    });
    if (!invoice || !isWithinBranchScope(invoice.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على فاتورة المبيعات');
    }
    return invoice;
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const invoice = await this.findOne(id, branchScope);
    const [customer, warehouse, branch, fiscalYear, period, users] =
      await Promise.all([
        this.customerRepository.findOne({ where: { id: invoice.customerId } }),
        invoice.warehouseId
          ? this.warehouseRepository.findOne({ where: { id: invoice.warehouseId } })
          : null,
        invoice.branchId
          ? this.branchRepository.findOne({ where: { id: invoice.branchId } })
          : null,
        this.fiscalYearRepository.findOne({ where: { id: invoice.fiscalYearId } }),
        this.periodRepository.findOne({ where: { id: invoice.accountingPeriodId } }),
        this.userNames([invoice.createdBy, invoice.postedBy, invoice.reversedBy]),
      ]);

    // Lines cancelled on the delivery order (credited by a posted return) — the
    // printout hides them and shows the credit, so it matches what is owed.
    const cancelledLines = await this.cancelledLines(invoice);
    return {
      ...invoice,
      cancelledLines,
      customerName: customer?.name ?? null,
      warehouseName: warehouse?.name ?? null,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(invoice.createdBy ?? '') ?? null,
      postedByName: users.get(invoice.postedBy ?? '') ?? null,
      reversedByName: users.get(invoice.reversedBy ?? '') ?? null,
    };
  }

  /** Products for the invoice picker with FREE qty (on hand − reserved) in the given warehouse. */
  async saleProducts(warehouseId?: string): Promise<SaleProductOption[]> {
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
    // «المتاح» = on hand − reserved for posted, undelivered invoices — what can
    // actually be sold now without promising the same goods twice.
    const qtyByProduct = new Map(
      stocks.map((s): [string, number] => [s.productId, Math.round((s.quantity - (s.reservedQuantity || 0)) * 1000) / 1000]),
    );
    const imgByProduct = new Map(images.map((i): [string, string] => [i.productId, i.url]));

    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      productType: p.productType,
      unitId: p.unitId,
      unitName: p.unit?.name ?? null,
      sellingPrice: p.sellingPrice,
      imageUrl: imgByProduct.get(p.id) ?? null,
      available: qtyByProduct.get(p.id) ?? 0,
    }));
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private toLineInputs(items: SalesInvoiceItemDto[]): SalesLineInput[] {
    return items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountType: (i.discountType ?? 'fixed') as SalesLineInput['discountType'],
      discountValue: i.discountValue ?? 0,
      vatRate: i.vatRate ?? 0,
    }));
  }

  /** The representative header warehouse = the first stock line that has one. */
  private pickHeaderWarehouse(items: SalesInvoiceItemDto[]): string | null {
    const stock = items.find(
      (i) => (i.lineType ?? SalesLineType.STOCK) === SalesLineType.STOCK && i.warehouseId,
    );
    return stock?.warehouseId ?? null;
  }

  /** Build persisted item rows with financial + product/unit snapshots. */
  private async buildItems(
    itemsDto: SalesInvoiceItemDto[],
    headerWarehouseId: string | null,
  ): Promise<SalesInvoiceItem[]> {
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

    // Load component products (with unit) for per-line BOM snapshots.
    const componentIds = [
      ...new Set(itemsDto.flatMap((i) => (i.components ?? []).map((c) => c.componentProductId))),
    ];
    const componentProducts = componentIds.length
      ? await this.productRepository.find({ where: { id: In(componentIds) }, relations: { unit: true } })
      : [];
    const componentById = new Map(componentProducts.map((p): [string, Product] => [p.id, p]));
    // Factories chosen on manufacturing lines must be real, active suppliers.
    const factoryIds = [
      ...new Set(
        itemsDto
          .filter((d) => (d.lineType ?? SalesLineType.STOCK) === SalesLineType.MANUFACTURING && d.factorySupplierId)
          .map((d) => d.factorySupplierId as string),
      ),
    ];
    if (factoryIds.length) {
      const found = await this.dataSource.getRepository(Supplier).count({ where: { id: In(factoryIds) } });
      if (found !== factoryIds.length) throw new BadRequestException('المصنع (المورد) المختار لأحد الأصناف غير موجود');
    }

    const computed = computeInvoice(this.toLineInputs(itemsDto)).lines;

    return itemsDto.map((dto, index) => {
      const product = productById.get(dto.productId);
      if (!product) {
        throw new BadRequestException('أحد المنتجات المختارة غير موجود');
      }
      const unitId = dto.unitId ?? product.unitId;
      const line = computed[index];

      const item = new SalesInvoiceItem();
      item.lineNumber = index + 1;
      item.productId = dto.productId;
      const lineType = (dto.lineType ?? SalesLineType.STOCK) as SalesInvoiceItem['lineType'];
      // Only a STOCK line sells from a warehouse; manufacturing and service
      // lines have none.
      item.warehouseId =
        lineType === SalesLineType.STOCK ? dto.warehouseId ?? headerWarehouseId : null;
      item.unitId = unitId ?? null;
      item.lineType = lineType;
      item.deliveryDate = dto.deliveryDate ?? null;
      item.dimensions = dto.dimensions ?? null;
      item.color = dto.color ?? null;
      item.material = dto.material ?? null;
      item.specifications = dto.specifications ?? null;
      const isMfg = lineType === SalesLineType.MANUFACTURING;
      item.factorySupplierId = isMfg ? dto.factorySupplierId ?? null : null;
      item.manufacturingFee = isMfg ? round2(dto.manufacturingFee ?? 0) : 0;
      item.productCode = product.code;
      item.productName = product.name;
      item.unitName = unitId ? unitById.get(unitId)?.name ?? null : null;
      item.quantity = dto.quantity;
      item.unitPrice = dto.unitPrice;
      item.discountType = (dto.discountType ?? 'fixed') as SalesInvoiceItem['discountType'];
      item.discountValue = dto.discountValue ?? 0;
      item.discountAmount = line.discountAmount;
      item.netBeforeTax = line.netBeforeTax;
      item.vatRate = dto.vatRate ?? 0;
      item.vatAmount = line.vatAmount;
      item.lineTotal = line.lineTotal;
      item.costAtPost = 0;
      // Per-order BOM (manufacturing lines only): snapshot component name/unit.
      if (lineType === SalesLineType.MANUFACTURING && dto.components?.length) {
        item.components = dto.components.map((c, ci) => {
          const cp = componentById.get(c.componentProductId);
          const comp = new SalesInvoiceItemComponent();
          comp.lineNumber = ci + 1;
          comp.componentProductId = c.componentProductId;
          comp.componentProductName = cp?.name ?? null;
          comp.unitName = cp?.unit?.name ?? null;
          comp.warehouseId = c.warehouseId ?? null;
          comp.quantity = c.quantity;
          return comp;
        });
      }
      return item;
    });
  }

  /** Build commission rows; a percentage is computed on the taxable (net) total. */
  private async buildCommissions(
    dtos: SalesInvoiceCommissionDto[],
    taxableAmount: number,
  ): Promise<SalesInvoiceCommission[]> {
    if (!dtos.length) return [];
    const ids = [...new Set(dtos.map((d) => d.employeeId))];
    const employees = await this.employeeRepository.find({ where: { id: In(ids) } });
    const byId = new Map(employees.map((e): [string, Employee] => [e.id, e]));
    return dtos.map((d, index) => {
      const emp = byId.get(d.employeeId);
      if (!emp) throw new BadRequestException('أحد الموظفين المختارين غير موجود');
      const c = new SalesInvoiceCommission();
      c.lineNumber = index + 1;
      c.employeeId = d.employeeId;
      c.employeeName = emp.name;
      c.commissionType = d.commissionType;
      c.value = d.value;
      c.amount =
        d.commissionType === SalesCommissionType.PERCENTAGE
          ? round2((taxableAmount * (d.value || 0)) / 100)
          : round2(d.value || 0);
      return c;
    });
  }

  private async getEditableDraft(id: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    const invoice = await this.findOne(id, branchScope);
    if (invoice.status !== SalesInvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن تعديل أو حذف فاتورة مُرحّلة — استخدم العكس أو المردود',
      );
    }
    return invoice;
  }

  private async assertHeaderRefs(dto: {
    customerId: string;
    warehouseId: string | null;
    fiscalYearId: string;
    accountingPeriodId: string;
  }): Promise<void> {
    const customer = await this.customerRepository.findOne({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');
    if (!customer.isActive) throw new BadRequestException('العميل غير نشط');

    // Warehouse is optional at the header (an all-manufacturing invoice has none).
    if (dto.warehouseId) {
      const warehouse = await this.warehouseRepository.findOne({
        where: { id: dto.warehouseId },
      });
      if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    }

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
