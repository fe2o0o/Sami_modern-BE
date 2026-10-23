import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { applyBranchScope, BranchScope } from '../../common/utils/branch-scope.util';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesInvoiceStatus, SalesLineType } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesDelivery } from '../sales-delivery/entities/sales-delivery.entity';
import { SalesDeliveryItem } from '../sales-delivery/entities/sales-delivery-item.entity';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { SalesReturnItem } from '../sales-return/entities/sales-return-item.entity';
import { SalesReturnStatus } from '../sales-return/enums/sales-return.enum';
import { Customer } from '../customer/entities/customer.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Product } from '../product/entities/product.entity';
import { categorySubtreeIds } from '../product-category/category-subtree.util';
import { ProductSalesDetailQueryDto } from './dto/product-sales-detail-query.dto';
import { round2 } from './ledger-math';

/** How the line's cost was obtained. */
export type CostBasis = 'actual' | 'partial' | 'estimated' | 'service' | 'none';

export interface ProductSalesDetailRow {
  itemId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  /** Sales employees on the invoice (commission lines) — can be several. */
  salesEmployees: string[];
  branchId: string | null;
  branchName: string | null;
  productId: string;
  productCode: string | null;
  productName: string;
  lineType: SalesLineType;
  factoryName: string | null;
  quantity: number;
  unitPrice: number;
  /** Line net after discount, before VAT. */
  netSales: number;
  returnedQuantity: number;
  returnedAmount: number;
  /** netSales − returns. */
  netRevenue: number;
  /** Cost of sales booked for this line (null when no cost is recorded yet). */
  cost: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  deliveredQuantity: number;
  costBasis: CostBasis;
}

export interface ProductSalesDetailReport {
  period: { from: string; to: string };
  summary: {
    lines: number;
    invoices: number;
    quantity: number;
    netSales: number;
    returns: number;
    netRevenue: number;
    /** Over lines that carry a cost. */
    cost: number;
    grossProfit: number;
    grossMargin: number | null;
    /** Revenue of lines with no recorded cost (excluded from profit). */
    uncostedRevenue: number;
  };
  items: ProductSalesDetailRow[];
  total: number;
  page: number;
  perPage: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const pad = (x: number) => String(x).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toYmd = (v: unknown): string => (v instanceof Date ? ymd(v) : String(v ?? '').slice(0, 10));

/*
 * Per-line cost = exactly what the books carry for the line on the COGS account
 * (same rule as the product income summary, so the two reconcile):
 *   cost accrued with the invoice
 *   + Σ (delivery lineCost − accrual it settled)       ← actual vs estimate
 *   − Σ posted returns (qty × costAtPost + released accrual)
 * Service lines carry no cost. A line with no accrual and nothing delivered
 * (legacy invoices) has no cost yet → null, excluded from profit.
 */
const DC = 'COALESCE(dc.adj, 0)';
const RR_COST = 'COALESCE(rr.costBack, 0)';
const HAS_COST = `(ii.cogsAccrued > 0 OR COALESCE(dc.cost, 0) > 0)`;
const COST = `(CASE WHEN ii.lineType = '${SalesLineType.SERVICE}' THEN 0 WHEN ${HAS_COST} THEN ii.cogsAccrued + ${DC} - ${RR_COST} ELSE NULL END)`;
const NET_REVENUE = '(ii.netBeforeTax - COALESCE(rr.amount, 0))';
const GROSS_PROFIT = `(${NET_REVENUE} - ${COST})`;
const MARGIN = `(CASE WHEN ${NET_REVENUE} <> 0 AND ${COST} IS NOT NULL THEN ${GROSS_PROFIT} / ${NET_REVENUE} * 100 ELSE NULL END)`;

const SORT_EXPR: Record<ProductSalesDetailQueryDto['sortBy'], string> = {
  invoiceDate: 'si.invoiceDate',
  netRevenue: NET_REVENUE,
  cost: COST,
  grossProfit: GROSS_PROFIT,
  grossMargin: MARGIN,
  quantity: 'ii.quantity',
};

/**
 * Product income DETAIL — every sold line of POSTED sales invoices (not grouped):
 * date, customer, sales employees, branch, product, line type, factory, price,
 * cost, gross profit and margin. Read-only; restricted to the branch scope.
 */
@Injectable()
export class ProductSalesDetailService {
  constructor(private readonly dataSource: DataSource) {}

  async report(q: ProductSalesDetailQueryDto, scope: BranchScope = null): Promise<ProductSalesDetailReport> {
    const today = new Date();
    const from = q.dateFrom ?? ymd(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = q.dateTo ?? ymd(today);
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    const categoryIds = await categorySubtreeIds(this.dataSource.manager, q.categoryId);

    const base = () => this.base(from, to, q, scope, categoryIds);

    const [rows, totals] = await Promise.all([
      base()
        .select('ii.id', 'itemId')
        .addSelect('si.id', 'invoiceId')
        .addSelect('si.invoiceNumber', 'invoiceNumber')
        .addSelect('si.invoiceDate', 'invoiceDate')
        .addSelect('si.customerId', 'customerId')
        .addSelect('c.name', 'customerName')
        .addSelect('si.branchId', 'branchId')
        .addSelect('b.name', 'branchName')
        .addSelect('ii.productId', 'productId')
        .addSelect('COALESCE(ii.productCode, p.code)', 'productCode')
        .addSelect('COALESCE(ii.productName, p.name)', 'productName')
        .addSelect('ii.lineType', 'lineType')
        .addSelect('sup.name', 'factoryName')
        .addSelect('ii.quantity', 'quantity')
        .addSelect('ii.unitPrice', 'unitPrice')
        .addSelect('ii.netBeforeTax', 'netSales')
        .addSelect('ii.deliveredQuantity', 'deliveredQuantity')
        .addSelect('COALESCE(rr.qty, 0)', 'returnedQuantity')
        .addSelect('COALESCE(rr.amount, 0)', 'returnedAmount')
        .addSelect(NET_REVENUE, 'netRevenue')
        .addSelect(COST, 'cost')
        .addSelect(MARGIN, 'grossMargin')
        .addSelect('ii.cogsAccrued', 'cogsAccrued')
        .orderBy(SORT_EXPR[q.sortBy] ?? 'si.invoiceDate', q.sortOrder === 'asc' ? 'ASC' : 'DESC')
        .addOrderBy('si.invoiceNumber', 'DESC')
        .addOrderBy('ii.lineNumber', 'ASC')
        .offset((q.page - 1) * q.perPage)
        .limit(q.perPage)
        .getRawMany<Record<string, unknown>>(),
      base()
        .select('COUNT(*)', 'lines')
        .addSelect('COUNT(DISTINCT si.id)', 'invoices')
        .addSelect('COALESCE(SUM(ii.quantity), 0)', 'quantity')
        .addSelect('COALESCE(SUM(ii.netBeforeTax), 0)', 'netSales')
        .addSelect('COALESCE(SUM(COALESCE(rr.amount, 0)), 0)', 'returns')
        .addSelect(`COALESCE(SUM(${NET_REVENUE}), 0)`, 'netRevenue')
        .addSelect(`COALESCE(SUM(${COST}), 0)`, 'cost')
        .addSelect(`COALESCE(SUM(CASE WHEN ${COST} IS NULL THEN 0 ELSE ${NET_REVENUE} END), 0)`, 'costedRevenue')
        .getRawOne<Record<string, string>>(),
    ]);

    // sales employees per invoice (several per invoice are possible)
    const invoiceIds = [...new Set(rows.map((r) => String(r.invoiceId)))];
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

    const items = rows.map((r): ProductSalesDetailRow => {
      const lineType = r.lineType as SalesLineType;
      const quantity = n(r.quantity);
      const delivered = n(r.deliveredQuantity);
      const netRevenue = round2(n(r.netRevenue));
      const cost = r.cost === null || r.cost === undefined ? null : round2(n(r.cost));
      const grossProfit = cost === null ? null : round2(netRevenue - cost);
      let costBasis: CostBasis;
      if (lineType === SalesLineType.SERVICE) costBasis = 'service';
      else if (cost === null) costBasis = 'none';
      else if (delivered >= quantity && quantity > 0) costBasis = 'actual';
      else if (delivered > 0) costBasis = 'partial';
      else costBasis = 'estimated';
      return {
        itemId: String(r.itemId),
        invoiceId: String(r.invoiceId),
        invoiceNumber: (r.invoiceNumber as string | null) ?? null,
        invoiceDate: toYmd(r.invoiceDate),
        customerId: String(r.customerId),
        customerName: (r.customerName as string | null) ?? '—',
        salesEmployees: employees.get(String(r.invoiceId)) ?? [],
        branchId: (r.branchId as string | null) ?? null,
        branchName: (r.branchName as string | null) ?? null,
        productId: String(r.productId),
        productCode: (r.productCode as string | null) ?? null,
        productName: (r.productName as string | null) ?? '—',
        lineType,
        factoryName: lineType === SalesLineType.MANUFACTURING ? ((r.factoryName as string | null) ?? null) : null,
        quantity,
        unitPrice: round2(n(r.unitPrice)),
        netSales: round2(n(r.netSales)),
        returnedQuantity: n(r.returnedQuantity),
        returnedAmount: round2(n(r.returnedAmount)),
        netRevenue,
        cost,
        grossProfit,
        grossMargin: grossProfit === null || netRevenue === 0 ? null : round2((grossProfit / netRevenue) * 100),
        deliveredQuantity: delivered,
        costBasis,
      };
    });

    const netRevenue = round2(n(totals?.netRevenue));
    const costedRevenue = round2(n(totals?.costedRevenue));
    const cost = round2(n(totals?.cost));
    const grossProfit = round2(costedRevenue - cost);
    return {
      period: { from, to },
      summary: {
        lines: n(totals?.lines),
        invoices: n(totals?.invoices),
        quantity: n(totals?.quantity),
        netSales: round2(n(totals?.netSales)),
        returns: round2(n(totals?.returns)),
        netRevenue,
        cost,
        grossProfit,
        grossMargin: costedRevenue !== 0 ? round2((grossProfit / costedRevenue) * 100) : null,
        uncostedRevenue: round2(netRevenue - costedRevenue),
      },
      items,
      total: n(totals?.lines),
      page: q.page,
      perPage: q.perPage,
    };
  }

  /** Posted invoice lines in range + every filter, with the cost/return side tables joined. */
  private base(from: string, to: string, q: ProductSalesDetailQueryDto, scope: BranchScope, categoryIds: string[] | null): SelectQueryBuilder<SalesInvoiceItem> {
    const qb = this.dataSource
      .getRepository(SalesInvoiceItem)
      .createQueryBuilder('ii')
      .innerJoin(SalesInvoice, 'si', 'si.id = ii.salesInvoiceId AND si.deletedAt IS NULL')
      .leftJoin(Customer, 'c', 'c.id = si.customerId')
      .leftJoin(Branch, 'b', 'b.id = si.branchId')
      .leftJoin(Product, 'p', 'p.id = ii.productId')
      .leftJoin(Supplier, 'sup', 'sup.id = ii.factorySupplierId')
      // delivered cost per invoice line
      .leftJoin(
        (sq) =>
          sq
            .select('di.salesInvoiceItemId', 'itemId')
            .addSelect('SUM(di.lineCost)', 'cost')
            .addSelect('SUM(di.lineCost - di.cogsAccrualSettled)', 'adj')
            .from(SalesDeliveryItem, 'di')
            .innerJoin(SalesDelivery, 'sd', 'sd.id = di.salesDeliveryId AND sd.deletedAt IS NULL')
            .where('di.deletedAt IS NULL')
            .andWhere('di.salesInvoiceItemId IS NOT NULL')
            .groupBy('di.salesInvoiceItemId'),
        'dc',
        'dc.itemId = ii.id',
      )
      // posted returns per invoice line
      .leftJoin(
        (sq) =>
          sq
            .select('ri.salesInvoiceItemId', 'itemId')
            .addSelect('SUM(ri.quantity)', 'qty')
            .addSelect('SUM(ri.netBeforeTax)', 'amount')
            .addSelect('SUM(ri.quantity * ri.costAtPost + ri.cogsAccrualReleased)', 'costBack')
            .from(SalesReturnItem, 'ri')
            .innerJoin(SalesReturn, 'sr', `sr.id = ri.salesReturnId AND sr.deletedAt IS NULL AND sr.status = '${SalesReturnStatus.POSTED}'`)
            .where('ri.deletedAt IS NULL')
            .andWhere('ri.salesInvoiceItemId IS NOT NULL')
            .groupBy('ri.salesInvoiceItemId'),
        'rr',
        'rr.itemId = ii.id',
      )
      .where('si.status = :st', { st: SalesInvoiceStatus.POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', { from, to });
    applyBranchScope(qb, 'si.branchId', scope);
    if (q.branchId) qb.andWhere('si.branchId = :branchId', { branchId: q.branchId });
    if (q.customerId) qb.andWhere('si.customerId = :customerId', { customerId: q.customerId });
    if (q.productId) qb.andWhere('ii.productId = :productId', { productId: q.productId });
    if (categoryIds) qb.andWhere('p.categoryId IN (:...categoryIds)', { categoryIds });
    if (q.lineType) qb.andWhere('ii.lineType = :lineType', { lineType: q.lineType });
    if (q.factorySupplierId) qb.andWhere('ii.factorySupplierId = :factory', { factory: q.factorySupplierId });
    if (q.warehouseId) qb.andWhere('COALESCE(ii.warehouseId, si.warehouseId) = :warehouseId', { warehouseId: q.warehouseId });
    if (q.employeeId) {
      qb.andWhere(
        (sub) =>
          'EXISTS ' +
          sub
            .subQuery()
            .select('1')
            .from(SalesInvoiceCommission, 'cm')
            .where('cm.salesInvoiceId = si.id')
            .andWhere('cm.employeeId = :employeeId')
            .getQuery(),
        { employeeId: q.employeeId },
      );
    }
    if (q.search?.trim()) {
      qb.andWhere('(si.invoiceNumber LIKE :s OR c.name LIKE :s OR ii.productName LIKE :s OR ii.productCode LIKE :s OR p.name LIKE :s)', {
        s: `%${q.search.trim()}%`,
      });
    }
    return qb;
  }
}
