import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceItem } from './entities/sales-invoice-item.entity';
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
  warehouseId: string;
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
  ): Promise<SalesInvoice> {
    await this.assertHeaderRefs(dto);
    const items = await this.buildItems(dto.items, dto.warehouseId);
    const { totals } = computeInvoice(this.toLineInputs(dto.items));
    const commissions = await this.buildCommissions(dto.commissions ?? [], totals.taxableAmount);
    const commissionTotal = round2(commissions.reduce((s, c) => s + c.amount, 0));

    const invoice = this.invoiceRepository.create({
      invoiceNumber: null,
      invoiceDate: dto.invoiceDate,
      customerId: dto.customerId,
      branchId: dto.branchId ?? null,
      warehouseId: dto.warehouseId,
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
  ): Promise<SalesInvoice> {
    const invoice = await this.getEditableDraft(id);

    if (dto.customerId) invoice.customerId = dto.customerId;
    if (dto.invoiceDate) invoice.invoiceDate = dto.invoiceDate;
    if (dto.branchId !== undefined) invoice.branchId = dto.branchId ?? null;
    if (dto.warehouseId) invoice.warehouseId = dto.warehouseId;
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

  async remove(id: string, actorId?: string): Promise<void> {
    await this.getEditableDraft(id);
    await this.invoiceRepository.update(id, { deletedBy: actorId ?? null });
    await this.invoiceRepository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: SalesInvoiceQueryDto,
  ): Promise<PaginatedResult<SalesInvoiceListItem>> {
    const qb = this.invoiceRepository.createQueryBuilder('si');

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

    qb.orderBy('si.invoiceDate', 'DESC').addOrderBy('si.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();

    const customerName = await this.nameMap(
      this.customerRepository,
      items.map((i) => i.customerId),
    );
    const warehouseName = await this.nameMap(
      this.warehouseRepository,
      items.map((i) => i.warehouseId),
    );

    const rows: SalesInvoiceListItem[] = items.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      customerId: i.customerId,
      customerName: customerName.get(i.customerId) ?? null,
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

  async findOne(id: string): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: { items: true, commissions: true },
      order: { items: { lineNumber: 'ASC' }, commissions: { lineNumber: 'ASC' } },
    });
    if (!invoice) {
      throw new NotFoundException('لم يتم العثور على فاتورة المبيعات');
    }
    return invoice;
  }

  async findOneDetailed(id: string): Promise<Record<string, unknown>> {
    const invoice = await this.findOne(id);
    const [customer, warehouse, branch, fiscalYear, period, users] =
      await Promise.all([
        this.customerRepository.findOne({ where: { id: invoice.customerId } }),
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

  /** Products for the invoice picker with on-hand qty in the given warehouse. */
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
    const qtyByProduct = new Map(stocks.map((s): [string, number] => [s.productId, s.quantity]));
    const imgByProduct = new Map(images.map((i): [string, string] => [i.productId, i.url]));

    return products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
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

  /** Build persisted item rows with financial + product/unit snapshots. */
  private async buildItems(
    itemsDto: SalesInvoiceItemDto[],
    warehouseId: string,
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
      item.warehouseId = warehouseId;
      item.unitId = unitId ?? null;
      item.lineType = (dto.lineType ?? SalesLineType.STOCK) as SalesInvoiceItem['lineType'];
      item.deliveryDate = dto.deliveryDate ?? null;
      item.dimensions = dto.dimensions ?? null;
      item.color = dto.color ?? null;
      item.material = dto.material ?? null;
      item.specifications = dto.specifications ?? null;
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

  private async getEditableDraft(id: string): Promise<SalesInvoice> {
    const invoice = await this.findOne(id);
    if (invoice.status !== SalesInvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'لا يمكن تعديل أو حذف فاتورة مُرحّلة — استخدم العكس أو المردود',
      );
    }
    return invoice;
  }

  private async assertHeaderRefs(dto: {
    customerId: string;
    warehouseId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
  }): Promise<void> {
    const customer = await this.customerRepository.findOne({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('العميل غير موجود');
    if (!customer.isActive) throw new BadRequestException('العميل غير نشط');

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
