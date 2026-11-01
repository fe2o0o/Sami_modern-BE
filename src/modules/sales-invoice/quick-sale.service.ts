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
    const date = dto.invoiceDate ?? todayIso();
    const warehouse = await this.dataSource.getRepository(Warehouse).findOne({ where: { id: dto.warehouseId } });
    if (!warehouse) throw new NotFoundException('المخزن غير موجود');
    if (warehouse.branchId && !isWithinBranchScope(warehouse.branchId, branchScope)) {
      throw new BadRequestException('المخزن خارج نطاق فروعك');
    }

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

    const customer = await this.quickCustomer();
    const draft = await this.invoices.create(
      {
        customerId: customer.id,
        invoiceDate: date,
        branchId: warehouse.branchId ?? undefined,
        warehouseId: warehouse.id,
        fiscalYearId: period.fiscalYearId,
        accountingPeriodId: period.id,
        paymentType: SalesPaymentType.CASH,
        cashAccountId: dto.cashAccountId ?? null,
        notes: dto.notes ?? null,
        items: dto.items.map((i) => ({
          productId: i.productId,
          warehouseId: warehouse.id,
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
      walkInCustomerName: dto.customerName,
      walkInCustomerMobile: dto.customerMobile ?? null,
    });
    try {
      return await this.posting.post(draft.id, actorId, branchScope);
    } catch (err) {
      // A failed post leaves no orphan draft behind.
      await this.invoices.remove(draft.id, actorId, branchScope).catch(() => undefined);
      throw err;
    }
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
