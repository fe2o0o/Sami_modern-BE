import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesDiscountType, SalesLineType, SalesPaymentType } from './enums/sales-invoice.enum';
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

  /**
   * «حفظ مسودة»: the same quick-sale invoice, saved as a DRAFT — nothing leaves the
   * warehouse and nothing is booked until it is posted from the invoice page (the
   * normal post endpoint; `isQuickSale` keeps the counter behaviour).
   */
  async createDraft(dto: QuickSaleDto, actorId?: string, branchScope: BranchScope = null): Promise<SalesInvoice> {
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
    const cashSplits = payments.length ? await this.namedSplits(payments) : null;
    const cashAccountId = payments[0]?.cashAccountId ?? dto.cashAccountId ?? null;

    const customer = dto.customerId ? await this.registeredCustomer(dto.customerId) : await this.quickCustomer();
    const draft = await this.invoices.create(
      {
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
      } as CreateSalesInvoiceDto,
      actorId,
      branchScope,
    );
    await this.dataSource.getRepository(SalesInvoice).update(draft.id, {
      isQuickSale: true,
      cashSplits,
      // A registered customer prints under their own name.
      walkInCustomerName: dto.customerId ? null : dto.customerName ?? null,
      walkInCustomerMobile: dto.customerId ? null : dto.customerMobile ?? null,
    });
    if (cashSplits && cashSplits.length > 1) {
      const paid = Math.round(cashSplits.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      if (Math.abs(paid - Number(draft.totalAmount)) > 0.005) {
        await this.invoices.remove(draft.id, actorId, branchScope).catch(() => undefined);
        throw new BadRequestException(`مجموع المبالغ المحصّلة (${paid.toFixed(2)}) لا يساوي إجمالي الفاتورة (${Number(draft.totalAmount).toFixed(2)})`);
      }
    }
    return draft;
  }

  /** Each part with its treasury / bank name, for the details page and printout. */
  private async namedSplits(
    payments: { cashAccountId: string; treasuryId?: string | null; bankAccountId?: string | null; amount: number }[],
  ): Promise<SalesCashSplit[]> {
    const ids = payments.map((p) => p.cashAccountId);
    const [treasuries, banks] = await Promise.all([
      this.dataSource.getRepository(Treasury).find({ where: { accountId: In(ids) } }),
      this.dataSource.getRepository(BankAccount).find({ where: { accountId: In(ids) } }),
    ]);
    const bankName = (b: BankAccount) => (b.accountName ? `${b.bankName} — ${b.accountName}` : b.bankName);
    return payments.map((p) => {
      const amount = Math.round(Number(p.amount) * 100) / 100;
      // The exact treasury / bank when given (must post through the same GL account) …
      if (p.treasuryId) {
        const t = treasuries.find((x) => x.id === p.treasuryId && x.accountId === p.cashAccountId);
        if (!t) throw new BadRequestException('الخزنة غير موجودة أو لا تطابق حسابها');
        return { cashAccountId: p.cashAccountId, treasuryId: t.id, bankAccountId: null, amount, accountName: t.name };
      }
      if (p.bankAccountId) {
        const b = banks.find((x) => x.id === p.bankAccountId && x.accountId === p.cashAccountId);
        if (!b) throw new BadRequestException('الحساب البنكي غير موجود أو لا يطابق حسابه');
        return { cashAccountId: p.cashAccountId, treasuryId: null, bankAccountId: b.id, amount, accountName: bankName(b) };
      }
      // … else the first one on that GL account.
      const t = treasuries.find((x) => x.accountId === p.cashAccountId);
      const b = banks.find((x) => x.accountId === p.cashAccountId);
      if (!t && !b) throw new BadRequestException('حساب التحصيل ليس خزنة أو حساباً بنكياً');
      return t
        ? { cashAccountId: p.cashAccountId, treasuryId: t.id, bankAccountId: null, amount, accountName: t.name }
        : { cashAccountId: p.cashAccountId, treasuryId: null, bankAccountId: b!.id, amount, accountName: bankName(b!) };
    });
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
