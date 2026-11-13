import { namedCashSplits } from './cash-splits.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesDiscountType, SalesInvoiceStatus, SalesLineType, SalesPaymentType } from './enums/sales-invoice.enum';
import { QuickSaleDto } from './dto/quick-sale.dto';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { SalesInvoiceService } from './sales-invoice.service';
import { SalesInvoicePostingService } from './sales-invoice-posting.service';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Product } from '../product/entities/product.entity';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { SalesCashSplit } from './entities/sales-invoice.entity';

/** The one system customer every quick sale is booked against. */
export const QUICK_SALE_CUSTOMER_CODE = 'QUICK-SALE';

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

/**
 * Quick sale (بيع سريع): builds a CASH stock invoice for a walk-in customer and
 * posts it in one call. The invoice goes through the normal create + post engine;
 * `isQuickSale` makes posting issue the goods and book their cost immediately
 * (no reservation, no delivery order — see SalesInvoicePostingService.post).
 */
@Injectable()
export class QuickSaleService {
  constructor(
    private readonly invoices: SalesInvoiceService,
    private readonly posting: SalesInvoicePostingService,
    private readonly dataSource: DataSource,
  ) {}

  async createAndPost(dto: QuickSaleDto, actorId?: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    const draft = await this.createDraft(dto, actorId, branchScope);
    try {
      return await this.posting.post(draft.id, actorId, branchScope);
    } catch (err) {
      // A failed post leaves no orphan draft behind.
      await this.invoices.remove(draft.id, actorId, branchScope).catch(() => undefined);
      throw err;
    }
  }

  /** The invoice input of a quick sale (validated: stock lines, one branch, open period). */
  private async prepare(dto: QuickSaleDto, branchScope: BranchScope) {
    const date = dto.invoiceDate ?? todayIso();
    const warehouse = await this.dataSource.getRepository(Warehouse).findOne({ where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    // Each row may come from its own warehouse — all in scope and in ONE branch
    // (shared warehouses have no branch and fit any); the sale takes that branch.
    const lineWarehouseIds = [...new Set([warehouse.id, ...dto.items.map((i) => i.warehouseId ?? warehouse.id)])];
    const warehouses = await this.dataSource.getRepository(Warehouse).find({ where: { id: In(lineWarehouseIds) } });
    if (warehouses.length !== lineWarehouseIds.length) throw new NotFoundException('أحد المخازن غير موجود');
    for (const w of warehouses) {
      if (w.branchId && !isWithinBranchScope(w.branchId, branchScope)) {
        throw new BadRequestException(`المخزن «${w.name}» خارج نطاق فروعك`);
      }
    }
    const branchIds = [...new Set(warehouses.map((w) => w.branchId).filter((b): b is string => !!b))];
    if (branchIds.length > 1) throw new BadRequestException('كل المخازن في الفاتورة يجب أن تكون من نفس الفرع');
    const saleBranchId = branchIds[0] ?? null;

    // Stock goods only — nothing made to order, no services.
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.dataSource.getRepository(Product).find({ where: { id: In(productIds) } });
    const byId = new Map(products.map((p): [string, Product] => [p.id, p]));
    for (const id of productIds) {
      const p = byId.get(id);
      if (!p) throw new BadRequestException('أحد الأصناف غير موجود');
      if (!p.trackInventory || p.productType === ProductType.SERVICE) {
        throw new BadRequestException(`الصنف «${p.name}» ليس صنفاً مخزنياً — البيع السريع من المخزن فقط`);
      }
    }

    const period = await this.dataSource
      .getRepository(AccountingPeriod)
      .createQueryBuilder('p')
      .where('p.startDate <= :d AND p.endDate >= :d', { d: date })
      .andWhere('p.isClosed = false')
      .getOne();
    if (!period) throw new BadRequestException('لا توجد فترة محاسبية مفتوحة تشمل تاريخ الفاتورة');

    // Sales commission lines as on a normal invoice — validated / resolved by the invoice engine.
    const commissions = dto.commissions ?? [];

    // Split collection (part cash, part bank …): the invoice keeps the first account;
    // posting checks Σ = total and books every part (see SalesInvoicePostingService).
    const payments = dto.payments ?? [];
    // Stored even for ONE method: it pins the exact treasury / bank (several can share a GL account).
    const cashSplits = payments.length ? await namedCashSplits(this.dataSource.manager, payments) : null;
    const cashAccountId = payments[0]?.cashAccountId ?? dto.cashAccountId ?? null;

    const customer = dto.customerId ? await this.registeredCustomer(dto.customerId) : await this.quickCustomer();
    const input = {
        customerId: customer.id,
        invoiceDate: date,
        branchId: saleBranchId ?? undefined,
        warehouseId: warehouse.id,
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: period.id,
        paymentType: SalesPaymentType.CASH,
        cashAccountId,
        notes: dto.notes ?? null,
        items: dto.items.map((i) => ({
          productId: i.productId,
          warehouseId: i.warehouseId ?? warehouse.id,
          lineType: SalesLineType.STOCK,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountType: i.discountType ?? SalesDiscountType.PERCENTAGE,
          discountValue: i.discountValue ?? 0,
          vatRate: i.vatRate ?? 0,
        })),
        commissions,
    } as CreateSalesInvoiceDto;
    const extras = {
      isQuickSale: true,
      cashSplits,
      // A registered customer prints under their own name.
      walkInCustomerName: dto.customerId ? null : dto.customerName ?? null,
      walkInCustomerMobile: dto.customerId ? null : dto.customerMobile ?? null,
    };
    return { input, extras, cashSplits };
  }

  /**
   * «حفظ مسودة»: the same quick-sale invoice, saved as a DRAFT — nothing leaves the
   * warehouse and nothing is booked until it is posted from the invoice page (the
   * normal post endpoint; `isQuickSale` keeps the counter behaviour).
   */
  async createDraft(dto: QuickSaleDto, actorId?: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    const { input, extras, cashSplits } = await this.prepare(dto, branchScope);
    const draft = await this.invoices.create(input, actorId, branchScope);
    await this.dataSource.getRepository(SalesInvoice).update(draft.id, extras);
    if (cashSplits && cashSplits.length > 1) {
      const paid = Math.round(cashSplits.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      if (Math.abs(paid - Number(draft.totalAmount)) > 0.005) {
        await this.invoices.remove(draft.id, actorId, branchScope).catch(() => undefined);
        throw new BadRequestException(`مجموع المبالغ المحصّلة (${paid.toFixed(2)}) لا يساوي إجمالي الفاتورة (${Number(draft.totalAmount).toFixed(2)})`);
      }
    }
    return draft;
  }

  /**
   * Edit a quick-sale DRAFT from the quick-sale popup: same rules as creating one;
   * it stays a quick sale (posting issues the goods — no delivery order).
   */
  async updateDraft(id: string, dto: QuickSaleDto, actorId?: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    const current = await this.dataSource.getRepository(SalesInvoice).findOne({ where: { id } });
    if (!current || !current.isQuickSale) throw new NotFoundException('مسودة البيع السريع غير موجودة');
    if (current.status !== SalesInvoiceStatus.DRAFT) throw new BadRequestException('لا يمكن تعديل بيع سريع بعد ترحيله');
    const { input, extras, cashSplits } = await this.prepare(dto, branchScope);
    const updated = await this.invoices.update(id, input, actorId, branchScope, { quickSale: true });
    if (cashSplits && cashSplits.length > 1) {
      const paid = Math.round(cashSplits.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      if (Math.abs(paid - Number(updated.totalAmount)) > 0.005) {
        throw new BadRequestException(`مجموع المبالغ المحصّلة (${paid.toFixed(2)}) لا يساوي إجمالي الفاتورة (${Number(updated.totalAmount).toFixed(2)})`);
      }
    }
    await this.dataSource.getRepository(SalesInvoice).update(id, extras);
    return updated;
  }

  /** Save the edited quick-sale draft and post it (goods issued now, no delivery order). */
  async updateAndPost(id: string, dto: QuickSaleDto, actorId?: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
    await this.updateDraft(id, dto, actorId, branchScope);
    return this.posting.post(id, actorId, branchScope);
  }

  /** A real, active customer picked on the quick sale (never the system holder). */
  private async registeredCustomer(id: string): Promise<Customer> {
    const customer = await this.dataSource.getRepository(Customer).findOne({ where: { id } });
    if (!customer || customer.code === QUICK_SALE_CUSTOMER_CODE) throw new NotFoundException('العميل غير موجود');
    if (!customer.isActive) throw new BadRequestException(`العميل «${customer.name}» غير نشط`);
    return customer;
  }

  /** «عميل بيع سريع» — created on first use. */
  private async quickCustomer(): Promise<Customer> {
    const repo = this.dataSource.getRepository(Customer);
    const existing = await repo.findOne({ where: { code: QUICK_SALE_CUSTOMER_CODE }, withDeleted: true });
    if (existing) {
      if (existing.deletedAt || !existing.isActive) {
        await repo.restore(existing.id);
        await repo.update(existing.id, { isActive: true });
      }
      return existing;
    }
    return repo.save(
      repo.create({
        code: QUICK_SALE_CUSTOMER_CODE,
        name: 'عميل بيع سريع',
        nameEn: 'Quick-sale customer',
        notes: 'عميل نظامي لفواتير البيع السريع — اسم العميل الفعلي ورقمه على كل فاتورة',
        isActive: true,
      }),
    );
  }
}
