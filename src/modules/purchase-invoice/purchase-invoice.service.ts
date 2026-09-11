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
    const items = await this.buildItems(dto.items, dto.warehouseId);
    const { totals } = computeInvoice(this.toLineInputs(dto.items));

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
  async findAll(
    query: PurchaseInvoiceQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<PurchaseInvoiceListItem>> {
    const qb = this.invoiceRepository.createQueryBuilder('pi');
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'pi.branchId', branchScope);

    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('pi.invoiceNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('pi.supplierInvoiceNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('pi.notes LIKE :s', { s: `%${query.search}%` });
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

    return {
      ...invoice,
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
  ): Promise<PurchaseInvoiceItem[]> {
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
      return item;
    });
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
