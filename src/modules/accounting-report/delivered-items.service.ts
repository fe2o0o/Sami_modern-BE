import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { applyBranchScope, BranchScope } from '../../common/utils/branch-scope.util';
import { SalesDelivery } from '../sales-delivery/entities/sales-delivery.entity';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { SalesDeliveryStatus } from '../sales-delivery/enums/sales-delivery.enum';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesLineType } from '../sales-invoice/enums/sales-invoice.enum';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Product } from '../product/entities/product.entity';
import { categorySubtreeIds } from '../product-category/category-subtree.util';
import { DeliveredItemsQueryDto } from './dto/delivered-items-query.dto';
import { round2 } from './ledger-math';

export interface DeliveredItemRow {
  itemId: string;
  deliveryId: string;
  deliveryNumber: string | null;
  deliveryDate: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  salesEmployees: string[];
  branchName: string | null;
  productId: string;
  productCode: string | null;
  productName: string;
  lineType: SalesLineType;
  /** Warehouse the goods left from (stock and produced manufacturing goods). */
  warehouseName: string | null;
  /** Manufacturing lines: the factory and the order. */
  factoryName: string | null;
  manufacturingOrderId: string | null;
  manufacturingOrderNumber: string | null;
  quantity: number;
  /** Invoice net (after discount, before VAT) of the delivered quantity. */
  salesValue: number | null;
  /** Actual cost issued from stock at delivery. */
  cost: number;
  grossProfit: number | null;
  grossMargin: number | null;
}

export interface DeliveredItemsReport {
  period: { from: string; to: string };
  summary: {
    lines: number;
    deliveries: number;
    quantity: number;
    stockQuantity: number;
    manufacturingQuantity: number;
    salesValue: number;
    cost: number;
    grossProfit: number;
    grossMargin: number | null;
  };
  items: DeliveredItemRow[];
  total: number;
  page: number;
  perPage: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const pad = (x: number) => String(x).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toYmd = (v: unknown): string => (v instanceof Date ? ymd(v) : String(v ?? '').slice(0, 10));

const DELIVERY_DATE = 'COALESCE(di.actualDeliveryDate, sd.deliveryDate)';
/** Invoice net of the delivered quantity (null for a delivery not linked to an invoice line). */
const SALES_VALUE = '(CASE WHEN ii.id IS NULL OR ii.quantity = 0 THEN NULL ELSE ii.netBeforeTax * di.deliveredQuantity / ii.quantity END)';
const GROSS_PROFIT = `(${SALES_VALUE} - di.lineCost)`;

const SORT_EXPR: Record<DeliveredItemsQueryDto['sortBy'], string> = {
  deliveryDate: DELIVERY_DATE,
  quantity: 'di.deliveredQuantity',
  salesValue: SALES_VALUE,
  cost: 'di.lineCost',
  grossProfit: GROSS_PROFIT,
};

/**
 * Delivered products, line by line (not grouped): every confirmed delivery line
 * with the warehouse it left from, or — for made-to-order goods — the factory and
 * manufacturing order, plus the delivered value, its actual cost and profit.
 * Read-only; restricted to the caller's branch scope.
 */
@Injectable()
export class DeliveredItemsService {
  constructor(private readonly dataSource: DataSource) {}

  async report(q: DeliveredItemsQueryDto, scope: BranchScope = null): Promise<DeliveredItemsReport> {
    const today = new Date();
    const from = q.dateFrom ?? ymd(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = q.dateTo ?? ymd(today);
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const categoryIds = await categorySubtreeIds(this.dataSource.manager, q.categoryId);
    const base = () => this.base(from, to, q, scope, categoryIds);

    const [rows, totals] = await Promise.all([
      base()
        .select('di.id', 'itemId')
        .addSelect('sd.id', 'deliveryId')
        .addSelect('sd.deliveryNumber', 'deliveryNumber')
        .addSelect(DELIVERY_DATE, 'deliveryDate')
        .addSelect('sd.salesInvoiceId', 'invoiceId')
        .addSelect('sd.invoiceNumber', 'invoiceNumber')
        .addSelect('sd.customerId', 'customerId')
        .addSelect('c.name', 'customerName')
        .addSelect('b.name', 'branchName')
        .addSelect('di.productId', 'productId')
        .addSelect('COALESCE(di.productCode, p.code)', 'productCode')
        .addSelect('COALESCE(di.productName, p.name)', 'productName')
        .addSelect('di.lineType', 'lineType')
        .addSelect('w.name', 'warehouseName')
        .addSelect('COALESCE(mo.factorySupplierName, sup.name)', 'factoryName')
        .addSelect('mo.id', 'manufacturingOrderId')
        .addSelect('mo.orderNumber', 'manufacturingOrderNumber')
        .addSelect('di.deliveredQuantity', 'quantity')
        .addSelect(SALES_VALUE, 'salesValue')
        .addSelect('di.lineCost', 'cost')
        .orderBy(SORT_EXPR[q.sortBy] ?? DELIVERY_DATE, q.sortOrder === 'asc' ? 'ASC' : 'DESC')
        .addOrderBy('sd.deliveryNumber', 'DESC')
        .addOrderBy('di.lineNumber', 'ASC')
        .offset((q.page - 1) * q.perPage)
        .limit(q.perPage)
        .getRawMany<Record<string, unknown>>(),
      base()
        .select('COUNT(*)', 'lines')
        .addSelect('COUNT(DISTINCT sd.id)', 'deliveries')
        .addSelect('COALESCE(SUM(di.deliveredQuantity), 0)', 'quantity')
        .addSelect(`COALESCE(SUM(CASE WHEN di.lineType = '${SalesLineType.STOCK}' THEN di.deliveredQuantity ELSE 0 END), 0)`, 'stockQuantity')
        .addSelect(`COALESCE(SUM(CASE WHEN di.lineType = '${SalesLineType.MANUFACTURING}' THEN di.deliveredQuantity ELSE 0 END), 0)`, 'manufacturingQuantity')
        .addSelect(`COALESCE(SUM(${SALES_VALUE}), 0)`, 'salesValue')
        .addSelect('COALESCE(SUM(di.lineCost), 0)', 'cost')
        .addSelect(`COALESCE(SUM(CASE WHEN ${SALES_VALUE} IS NULL THEN 0 ELSE di.lineCost END), 0)`, 'pricedCost')
        .getRawOne<Record<string, string>>(),
    ]);

    // sales employees per invoice
    const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter(Boolean).map(String))];
    const employees = new Map<string, string[]>();
    if (invoiceIds.length) {
      const list = await this.dataSource
        .getRepository(SalesInvoiceCommission)
        .createQueryBuilder('cm')
        .select(['cm.salesInvoiceId AS invoiceId', 'cm.employeeName AS name'])
        .where('cm.salesInvoiceId IN (:...ids)', { ids: invoiceIds })
        .orderBy('cm.lineNumber', 'ASC')
        .getRawMany<{ invoiceId: string; name: string | null }>();
      for (const e of list) {
        const names = employees.get(e.invoiceId) ?? [];
        if (e.name && !names.includes(e.name)) names.push(e.name);
        employees.set(e.invoiceId, names);
      }
    }

    const items = rows.map((r): DeliveredItemRow => {
      const lineType = r.lineType as SalesLineType;
      const salesValue = r.salesValue === null || r.salesValue === undefined ? null : round2(n(r.salesValue));
      const cost = round2(n(r.cost));
      const grossProfit = salesValue === null ? null : round2(salesValue - cost);
      const isMfg = lineType === SalesLineType.MANUFACTURING;
      return {
        itemId: String(r.itemId),
        deliveryId: String(r.deliveryId),
        deliveryNumber: (r.deliveryNumber as string | null) ?? null,
        deliveryDate: toYmd(r.deliveryDate),
        invoiceId: (r.invoiceId as string | null) ?? null,
        invoiceNumber: (r.invoiceNumber as string | null) ?? null,
        customerId: String(r.customerId),
        customerName: (r.customerName as string | null) ?? '—',
        salesEmployees: r.invoiceId ? employees.get(String(r.invoiceId)) ?? [] : [],
        branchName: (r.branchName as string | null) ?? null,
        productId: String(r.productId),
        productCode: (r.productCode as string | null) ?? null,
        productName: (r.productName as string | null) ?? '—',
        lineType,
        warehouseName: (r.warehouseName as string | null) ?? null,
        factoryName: isMfg ? ((r.factoryName as string | null) ?? null) : null,
        manufacturingOrderId: isMfg ? ((r.manufacturingOrderId as string | null) ?? null) : null,
        manufacturingOrderNumber: isMfg ? ((r.manufacturingOrderNumber as string | null) ?? null) : null,
        quantity: n(r.quantity),
        salesValue,
        cost,
        grossProfit,
        grossMargin: grossProfit === null || !salesValue ? null : round2((grossProfit / salesValue) * 100),
      };
    });

    const salesValue = round2(n(totals?.salesValue));
    const grossProfit = round2(salesValue - n(totals?.pricedCost));
    return {
      period: { from, to },
      summary: {
        lines: n(totals?.lines),
        deliveries: n(totals?.deliveries),
        quantity: n(totals?.quantity),
        stockQuantity: n(totals?.stockQuantity),
        manufacturingQuantity: n(totals?.manufacturingQuantity),
        salesValue,
        cost: round2(n(totals?.cost)),
        grossProfit,
        grossMargin: salesValue ? round2((grossProfit / salesValue) * 100) : null,
      },
      items,
      total: n(totals?.lines),
      page: q.page,
      perPage: q.perPage,
    };
  }

  /** Confirmed delivery lines in range + every filter. */
  private base(from: string, to: string, q: DeliveredItemsQueryDto, scope: BranchScope, categoryIds: string[] | null): SelectQueryBuilder<SalesDeliveryItem> {
    const qb = this.dataSource
      .getRepository(SalesDeliveryItem)
      .createQueryBuilder('di')
      .innerJoin(SalesDelivery, 'sd', 'sd.id = di.salesDeliveryId AND sd.deletedAt IS NULL')
      .leftJoin(SalesInvoiceItem, 'ii', 'ii.id = di.salesInvoiceItemId AND ii.deletedAt IS NULL')
      .leftJoin(ManufacturingOrder, 'mo', 'mo.id = di.manufacturingOrderId')
      .leftJoin(Supplier, 'sup', 'sup.id = ii.factorySupplierId')
      .leftJoin(Warehouse, 'w', 'w.id = COALESCE(di.warehouseId, sd.warehouseId)')
      .leftJoin(Customer, 'c', 'c.id = sd.customerId')
      .leftJoin(Branch, 'b', 'b.id = sd.branchId')
      .leftJoin(Product, 'p', 'p.id = di.productId')
      .where('sd.status <> :rev', { rev: SalesDeliveryStatus.REVERSED })
      .andWhere('di.deliveredQuantity > 0')
      .andWhere(`${DELIVERY_DATE} BETWEEN :from AND :to`, { from, to });
    applyBranchScope(qb, 'sd.branchId', scope);
    if (q.branchId) qb.andWhere('sd.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('sd.customerId = :customerId', { customerId: q.customerId });
    if (q.productId) qb.andWhere('di.productId = :productId', { productId: q.productId });
    if (categoryIds) qb.andWhere('p.categoryId IN (:...categoryIds)', { categoryIds });
    if (q.lineType) qb.andWhere('di.lineType = :lineType', { lineType: q.lineType });
    if (q.warehouseId) qb.andWhere('COALESCE(di.warehouseId, sd.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    if (q.factorySupplierId) qb.andWhere('COALESCE(mo.factorySupplierId, ii.factorySupplierId) = :factory', { factory: q.factorySupplierId });
    if (q.employeeId) {
      qb.andWhere(
        (sub) =>
          'EXISTS ' +
          sub
            .subQuery()
            .select('1')
            .from(SalesInvoiceCommission, 'cm')
            .where('cm.salesInvoiceId = sd.salesInvoiceId')
            .andWhere('cm.employeeId = :employeeId')
            .getQuery(),
        { employeeId: q.employeeId },
      );
    }
    if (q.search?.trim()) {
      qb.andWhere(
        '(sd.deliveryNumber LIKE :s OR sd.invoiceNumber LIKE :s OR mo.orderNumber LIKE :s OR c.name LIKE :s OR di.productName LIKE :s OR di.productCode LIKE :s OR p.name LIKE :s)',
        { s: `%${q.search.trim()}%` },
      );
    }
    return qb;
  }
}
