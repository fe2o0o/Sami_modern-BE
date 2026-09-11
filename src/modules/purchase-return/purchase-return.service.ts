import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { PurchaseReturnStatus } from './enums/purchase-return.enum';
import { CreatePurchaseReturnDto, PurchaseReturnItemDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';
import { PurchaseReturnQueryDto } from './dto/purchase-return-query.dto';
import { PurchaseInvoice } from '../purchase-invoice/entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../purchase-invoice/entities/purchase-invoice-item.entity';
import { PurchaseInvoiceStatus } from '../purchase-invoice/enums/purchase-invoice.enum';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface PurchaseReturnListItem {
  id: string;
  returnNumber: string | null;
  returnDate: string;
  invoiceNumber: string | null;
  supplierId: string;
  supplierName: string | null;
  totalAmount: number;
  status: PurchaseReturnStatus;
}

export interface ReturnableLine {
  purchaseInvoiceItemId: string;
  productId: string;
  productCode: string | null;
  productName: string | null;
  unitName: string | null;
  purchasedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
}

function round2(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }
function round3(v: number): number { return Math.round((v + Number.EPSILON) * 1000) / 1000; }

@Injectable()
export class PurchaseReturnService {
  constructor(
    @InjectRepository(PurchaseReturn)
    private readonly repository: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseReturnItem)
    private readonly itemRepository: Repository<PurchaseReturnItem>,
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepository: Repository<PurchaseInvoice>,
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
    private readonly dataSource: DataSource,
  ) {}

  async returnableItems(invoiceId: string): Promise<{ invoice: Record<string, unknown>; lines: ReturnableLine[] }> {
    const invoice = await this.loadPostedInvoice(invoiceId);
    const returned = await this.returnedQtyByItem(invoice.items.map((i) => i.id));
    const lines: ReturnableLine[] = invoice.items.map((it) => {
      const returnedQty = returned.get(it.id) ?? 0;
      return {
        purchaseInvoiceItemId: it.id,
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        unitName: it.unitName,
        purchasedQuantity: it.quantity,
        returnedQuantity: round3(returnedQty),
        remainingQuantity: round3(it.quantity - returnedQty),
        unitPrice: it.unitPrice,
      };
    });
    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplierId: invoice.supplierId,
        warehouseId: invoice.warehouseId,
        paymentType: invoice.paymentType,
        branchId: invoice.branchId,
      },
      lines,
    };
  }

  async create(
    dto: CreatePurchaseReturnDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<PurchaseReturn> {
    const invoice = await this.loadPostedInvoice(dto.purchaseInvoiceId);
    await this.assertPeriod(dto.fiscalYearId, dto.accountingPeriodId);
    const items = await this.buildItems(invoice, dto.items);
    const totals = this.sumTotals(items);
    const ret = this.repository.create({
      returnNumber: null,
      returnDate: dto.returnDate,
      purchaseInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierId: invoice.supplierId,
      warehouseId: invoice.warehouseId,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: resolveWriteBranch(branchScope, invoice.branchId),
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      paymentType: invoice.paymentType,
      cashAccountId: invoice.cashAccountId,
      status: PurchaseReturnStatus.DRAFT,
      notes: dto.notes ?? null,
      createdBy: actorId ?? null,
      items,
      ...totals,
    });
    return this.repository.save(ret);
  }

  async update(
    id: string,
    dto: UpdatePurchaseReturnDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<PurchaseReturn> {
    const ret = await this.getEditableDraft(id, branchScope);
    if (dto.returnDate) ret.returnDate = dto.returnDate;
    if (dto.fiscalYearId) ret.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) ret.accountingPeriodId = dto.accountingPeriodId;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope !== null) ret.branchId = resolveWriteBranch(branchScope, ret.branchId);
    if (dto.notes !== undefined) ret.notes = dto.notes ?? null;
    await this.assertPeriod(ret.fiscalYearId, ret.accountingPeriodId);

    return this.dataSource.transaction(async (manager) => {
      if (dto.items) {
        const invoice = await this.loadPostedInvoice(ret.purchaseInvoiceId);
        await manager.delete(PurchaseReturnItem, { purchaseReturnId: id });
        const items = await this.buildItems(invoice, dto.items, id);
        ret.items = items;
        Object.assign(ret, this.sumTotals(items));
      }
      ret.updatedBy = actorId ?? null;
      return manager.getRepository(PurchaseReturn).save(ret);
    });
  }

  async remove(id: string, actorId?: string, branchScope: BranchScope = null): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.repository.update(id, { deletedBy: actorId ?? null });
    await this.repository.softDelete(id);
  }

  async findAll(
    query: PurchaseReturnQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<PurchaseReturnListItem>> {
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
    if (query.supplierId) qb.andWhere('r.supplierId = :su', { su: query.supplierId });
    if (query.purchaseInvoiceId) qb.andWhere('r.purchaseInvoiceId = :pi', { pi: query.purchaseInvoiceId });
    if (query.fiscalYearId) qb.andWhere('r.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.status) qb.andWhere('r.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('r.returnDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('r.returnDate <= :dt', { dt: query.dateTo });
    qb.orderBy('r.returnDate', 'DESC').addOrderBy('r.createdAt', 'DESC').skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const names = await this.nameMap(this.supplierRepository, items.map((i) => i.supplierId));
    const rows: PurchaseReturnListItem[] = items.map((r) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      returnDate: r.returnDate,
      invoiceNumber: r.invoiceNumber,
      supplierId: r.supplierId,
      supplierName: names.get(r.supplierId) ?? null,
      totalAmount: r.totalAmount,
      status: r.status,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<PurchaseReturn> {
    const r = await this.repository.findOne({
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!r || !isWithinBranchScope(r.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على مردود المشتريات');
    }
    return r;
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const r = await this.findOne(id, branchScope);
    const [supplier, warehouse, branch, fiscalYear, period, users] = await Promise.all([
      this.supplierRepository.findOne({ where: { id: r.supplierId } }),
      this.warehouseRepository.findOne({ where: { id: r.warehouseId } }),
      r.branchId ? this.branchRepository.findOne({ where: { id: r.branchId } }) : null,
      this.fiscalYearRepository.findOne({ where: { id: r.fiscalYearId } }),
      this.periodRepository.findOne({ where: { id: r.accountingPeriodId } }),
      this.userNames([r.createdBy, r.postedBy, r.reversedBy]),
    ]);
    return {
      ...r,
      supplierName: supplier?.name ?? null,
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
  private async buildItems(
    invoice: PurchaseInvoice,
    dtos: PurchaseReturnItemDto[],
    excludeReturnId?: string,
  ): Promise<PurchaseReturnItem[]> {
    const itemById = new Map(invoice.items.map((i): [string, PurchaseInvoiceItem] => [i.id, i]));
    const alreadyReturned = await this.returnedQtyByItem(invoice.items.map((i) => i.id), excludeReturnId);
    const requested = new Map<string, number>();
    for (const d of dtos) requested.set(d.purchaseInvoiceItemId, round3((requested.get(d.purchaseInvoiceItemId) ?? 0) + d.quantity));

    return dtos.map((d, index) => {
      const src = itemById.get(d.purchaseInvoiceItemId);
      if (!src) throw new BadRequestException('أحد السطور لا يخص هذه الفاتورة');
      const remaining = round3(src.quantity - (alreadyReturned.get(src.id) ?? 0));
      if (requested.get(src.id)! - remaining > 1e-6) {
        throw new BadRequestException(`الكمية المرتجعة من "${src.productName}" تتجاوز المتبقي (${remaining})`);
      }
      const ratio = d.quantity / (src.quantity || 1);
      const item = new PurchaseReturnItem();
      item.lineNumber = index + 1;
      item.purchaseInvoiceItemId = src.id;
      item.productId = src.productId;
      item.warehouseId = invoice.warehouseId;
      item.unitId = src.unitId;
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
      item.unitCostAtPost = src.unitCostAtPost;
      return item;
    });
  }

  private sumTotals(items: PurchaseReturnItem[]) {
    const subtotal = round2(items.reduce((s, i) => s + round2(i.quantity * i.unitPrice), 0));
    const discountAmount = round2(items.reduce((s, i) => s + i.discountAmount, 0));
    const taxableAmount = round2(items.reduce((s, i) => s + i.netBeforeTax, 0));
    const vatAmount = round2(items.reduce((s, i) => s + i.vatAmount, 0));
    const totalAmount = round2(taxableAmount + vatAmount);
    return { subtotal, discountAmount, taxableAmount, vatAmount, totalAmount };
  }

  private async returnedQtyByItem(invoiceItemIds: string[], excludeReturnId?: string): Promise<Map<string, number>> {
    if (!invoiceItemIds.length) return new Map();
    const qb = this.itemRepository
      .createQueryBuilder('ri')
      .innerJoin('ri.purchaseReturn', 'r')
      .select('ri.purchaseInvoiceItemId', 'itemId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .where('ri.purchaseInvoiceItemId IN (:...ids)', { ids: invoiceItemIds })
      .andWhere('r.status != :reversed', { reversed: PurchaseReturnStatus.REVERSED })
      .groupBy('ri.purchaseInvoiceItemId');
    if (excludeReturnId) qb.andWhere('r.id != :ex', { ex: excludeReturnId });
    const rows = await qb.getRawMany<{ itemId: string; qty: string }>();
    return new Map(rows.map((r): [string, number] => [r.itemId, Number(r.qty)]));
  }

  private async loadPostedInvoice(invoiceId: string): Promise<PurchaseInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    });
    if (!invoice) throw new NotFoundException('فاتورة المشتريات الأصلية غير موجودة');
    if (invoice.status !== PurchaseInvoiceStatus.POSTED) {
      throw new BadRequestException('لا يمكن إنشاء مردود إلا من فاتورة مشتريات مُرحّلة');
    }
    return invoice;
  }

  private async getEditableDraft(id: string, branchScope: BranchScope = null): Promise<PurchaseReturn> {
    const r = await this.findOne(id, branchScope);
    if (r.status !== PurchaseReturnStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف مردود مُرحّل — استخدم العكس');
    }
    return r;
  }

  private async assertPeriod(fiscalYearId: string, periodId: string): Promise<void> {
    const period = await this.periodRepository.findOne({ where: { id: periodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYearId) throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
  }

  private async nameMap<T extends { id: string; name: string }>(repo: Repository<T>, ids: string[]): Promise<Map<string, string>> {
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
