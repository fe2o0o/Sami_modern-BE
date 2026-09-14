import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { BranchScope, applyBranchScope } from '../../common/utils/branch-scope.util';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { PurchaseInvoice } from '../purchase-invoice/entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../purchase-invoice/entities/purchase-invoice-item.entity';
import { PurchaseReturn } from '../purchase-return/entities/purchase-return.entity';
import { CustomerTransaction } from '../customer/entities/customer-transaction.entity';
import { SupplierTransaction } from '../supplier/entities/supplier-transaction.entity';
import { TreasuryTransaction } from '../treasury/entities/treasury-transaction.entity';
import { BankTransaction } from '../bank-account/entities/bank-transaction.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

const POSTED = 'posted';

interface Range {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  bucket: 'day' | 'month';
}

interface Delta {
  value: number;
  prev: number;
  changePct: number | null;
}

const n = (v: unknown): number => Number(v) || 0;
const r2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(SalesInvoice) private readonly salesRepo: Repository<SalesInvoice>,
    @InjectRepository(SalesInvoiceItem) private readonly salesItemRepo: Repository<SalesInvoiceItem>,
    @InjectRepository(SalesReturn) private readonly salesReturnRepo: Repository<SalesReturn>,
    @InjectRepository(PurchaseInvoice) private readonly purchaseRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceItem) private readonly purchaseItemRepo: Repository<PurchaseInvoiceItem>,
    @InjectRepository(PurchaseReturn) private readonly purchaseReturnRepo: Repository<PurchaseReturn>,
    @InjectRepository(CustomerTransaction) private readonly custTxnRepo: Repository<CustomerTransaction>,
    @InjectRepository(SupplierTransaction) private readonly suppTxnRepo: Repository<SupplierTransaction>,
    @InjectRepository(TreasuryTransaction) private readonly treasuryTxnRepo: Repository<TreasuryTransaction>,
    @InjectRepository(BankTransaction) private readonly bankTxnRepo: Repository<BankTransaction>,
    @InjectRepository(WarehouseStock) private readonly stockRepo: Repository<WarehouseStock>,
    @InjectRepository(ManufacturingOrder) private readonly moRepo: Repository<ManufacturingOrder>,
  ) {}

  // =========================================================
  // FINANCIAL TAB
  // =========================================================
  async financial(q: DashboardQueryDto, scope: BranchScope): Promise<Record<string, unknown>> {
    const range = this.resolveRange(q);
    const [sales, salesPrev, purchases, purchasesPrev, receivables, payables, cash, cashFlow, trend, topDebtors, topCreditors] =
      await Promise.all([
        this.invoiceTotal(this.salesRepo, 'si', range.from, range.to, scope, q.branchId),
        this.invoiceTotal(this.salesRepo, 'si', range.prevFrom, range.prevTo, scope, q.branchId),
        this.invoiceTotal(this.purchaseRepo, 'pi', range.from, range.to, scope, q.branchId),
        this.invoiceTotal(this.purchaseRepo, 'pi', range.prevFrom, range.prevTo, scope, q.branchId),
        this.receivables(),
        this.payables(),
        this.cashOnHand(),
        this.cashFlow(range),
        this.salesPurchaseTrend(range, scope, q.branchId),
        this.topDebtors(),
        this.topCreditors(),
      ]);

    return {
      range: { from: range.from, to: range.to },
      kpis: {
        sales: this.delta(sales.total, salesPrev.total),
        purchases: this.delta(purchases.total, purchasesPrev.total),
        receivables,
        payables,
        cashOnHand: cash,
        netCashFlow: r2(cashFlow.in - cashFlow.out),
      },
      cashFlow,
      trend,
      topDebtors,
      topCreditors,
    };
  }

  // =========================================================
  // SALES TAB
  // =========================================================
  async sales(q: DashboardQueryDto, scope: BranchScope): Promise<Record<string, unknown>> {
    const range = this.resolveRange(q);
    const [cur, prev, returns, paymentMix, trend, topProducts, topCustomers, delivery, recent] =
      await Promise.all([
        this.invoiceTotal(this.salesRepo, 'si', range.from, range.to, scope, q.branchId),
        this.invoiceTotal(this.salesRepo, 'si', range.prevFrom, range.prevTo, scope, q.branchId),
        this.returnTotal(this.salesReturnRepo, 'sr', range, scope, q.branchId),
        this.salesPaymentMix(range, scope, q.branchId),
        this.invoiceTrend(this.salesRepo, 'si', range, scope, q.branchId),
        this.topSalesProducts(range, scope, q.branchId),
        this.topCustomers(range, scope, q.branchId),
        this.deliveryStatus(range, scope, q.branchId),
        this.recentSales(scope, q.branchId),
      ]);

    return {
      range: { from: range.from, to: range.to },
      kpis: {
        sales: this.delta(cur.total, prev.total),
        invoiceCount: cur.count,
        avgInvoice: cur.count ? r2(cur.total / cur.count) : 0,
        returns,
      },
      paymentMix,
      trend,
      topProducts,
      topCustomers,
      deliveryStatus: delivery,
      recentInvoices: recent,
    };
  }

  // =========================================================
  // PURCHASES TAB
  // =========================================================
  async purchases(q: DashboardQueryDto, scope: BranchScope): Promise<Record<string, unknown>> {
    const range = this.resolveRange(q);
    const [cur, prev, returns, trend, topProducts, topSuppliers, recent] = await Promise.all([
      this.invoiceTotal(this.purchaseRepo, 'pi', range.from, range.to, scope, q.branchId),
      this.invoiceTotal(this.purchaseRepo, 'pi', range.prevFrom, range.prevTo, scope, q.branchId),
      this.returnTotal(this.purchaseReturnRepo, 'pr', range, scope, q.branchId),
      this.invoiceTrend(this.purchaseRepo, 'pi', range, scope, q.branchId),
      this.topPurchaseProducts(range, scope, q.branchId),
      this.topSuppliers(range, scope, q.branchId),
      this.recentPurchases(scope, q.branchId),
    ]);

    return {
      range: { from: range.from, to: range.to },
      kpis: {
        purchases: this.delta(cur.total, prev.total),
        invoiceCount: cur.count,
        avgInvoice: cur.count ? r2(cur.total / cur.count) : 0,
        returns,
      },
      trend,
      topProducts,
      topSuppliers,
      recentInvoices: recent,
    };
  }

  // =========================================================
  // INVENTORY TAB (current state — not period-bound)
  // =========================================================
  async inventory(q: DashboardQueryDto, scope: BranchScope): Promise<Record<string, unknown>> {
    const [summary, lowStock, byWarehouse, mo] = await Promise.all([
      this.stockSummary(scope, q.branchId),
      this.lowStock(scope, q.branchId),
      this.stockValueByWarehouse(scope, q.branchId),
      this.manufacturingByStatus(scope, q.branchId),
    ]);
    return { kpis: summary, lowStock, stockByWarehouse: byWarehouse, manufacturing: mo };
  }

  // =========================================================
  // BUILDING BLOCKS
  // =========================================================
  /** Posted-invoice total + count in a date range (sales or purchases). */
  private async invoiceTotal(
    repo: Repository<SalesInvoice | PurchaseInvoice>,
    alias: string,
    from: string,
    to: string,
    scope: BranchScope,
    branchId?: string,
  ): Promise<{ total: number; count: number }> {
    const qb = repo
      .createQueryBuilder(alias)
      .select(`COALESCE(SUM(${alias}.totalAmount),0)`, 'total')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.status = :st`, { st: POSTED })
      .andWhere(`${alias}.invoiceDate BETWEEN :from AND :to`, { from, to });
    this.scopeBranch(qb, `${alias}.branchId`, scope, branchId);
    const raw = await qb.getRawOne<{ total: string; count: string }>();
    return { total: r2(n(raw?.total)), count: n(raw?.count) };
  }

  /** Posted-return total in a range (sales or purchase returns). */
  private async returnTotal(
    repo: Repository<SalesReturn | PurchaseReturn>,
    alias: string,
    range: Range,
    scope: BranchScope,
    branchId?: string,
  ): Promise<number> {
    const qb = repo
      .createQueryBuilder(alias)
      .select(`COALESCE(SUM(${alias}.totalAmount),0)`, 'total')
      .where(`${alias}.status = :st`, { st: POSTED })
      .andWhere(`${alias}.returnDate BETWEEN :from AND :to`, { from: range.from, to: range.to });
    this.scopeBranch(qb, `${alias}.branchId`, scope, branchId);
    const raw = await qb.getRawOne<{ total: string }>();
    return r2(n(raw?.total));
  }

  /** Sales + purchases totals bucketed by day/month for the combined trend chart. */
  private async salesPurchaseTrend(
    range: Range,
    scope: BranchScope,
    branchId?: string,
  ): Promise<{ bucket: string; sales: number; purchases: number }[]> {
    const [sales, purchases] = await Promise.all([
      this.invoiceTrend(this.salesRepo, 'si', range, scope, branchId),
      this.invoiceTrend(this.purchaseRepo, 'pi', range, scope, branchId),
    ]);
    const map = new Map<string, { bucket: string; sales: number; purchases: number }>();
    for (const s of sales) map.set(s.bucket, { bucket: s.bucket, sales: s.total, purchases: 0 });
    for (const p of purchases) {
      const e = map.get(p.bucket) ?? { bucket: p.bucket, sales: 0, purchases: 0 };
      e.purchases = p.total;
      map.set(p.bucket, e);
    }
    return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  /** Posted-invoice total per day (or month) for a trend line. */
  private async invoiceTrend(
    repo: Repository<SalesInvoice | PurchaseInvoice>,
    alias: string,
    range: Range,
    scope: BranchScope,
    branchId?: string,
  ): Promise<{ bucket: string; total: number }[]> {
    const bucketExpr =
      range.bucket === 'month'
        ? `DATE_FORMAT(${alias}.invoiceDate, '%Y-%m')`
        : `DATE_FORMAT(${alias}.invoiceDate, '%Y-%m-%d')`;
    const qb = repo
      .createQueryBuilder(alias)
      .select(bucketExpr, 'bucket')
      .addSelect(`COALESCE(SUM(${alias}.totalAmount),0)`, 'total')
      .where(`${alias}.status = :st`, { st: POSTED })
      .andWhere(`${alias}.invoiceDate BETWEEN :from AND :to`, { from: range.from, to: range.to })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC');
    this.scopeBranch(qb, `${alias}.branchId`, scope, branchId);
    const rows = await qb.getRawMany<{ bucket: string; total: string }>();
    return rows.map((x) => ({ bucket: x.bucket, total: r2(n(x.total)) }));
  }

  /** Cash vs credit split of posted sales in range. */
  private async salesPaymentMix(
    range: Range,
    scope: BranchScope,
    branchId?: string,
  ): Promise<{ cash: number; credit: number }> {
    const qb = this.salesRepo
      .createQueryBuilder('si')
      .select('si.paymentType', 'type')
      .addSelect('COALESCE(SUM(si.totalAmount),0)', 'total')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('si.paymentType');
    this.scopeBranch(qb, 'si.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ type: string; total: string }>();
    const out = { cash: 0, credit: 0 };
    for (const x of rows) {
      if (x.type === 'cash') out.cash = r2(n(x.total));
      else if (x.type === 'credit') out.credit = r2(n(x.total));
    }
    return out;
  }

  private async topSalesProducts(range: Range, scope: BranchScope, branchId?: string) {
    const qb = this.salesItemRepo
      .createQueryBuilder('it')
      .innerJoin(SalesInvoice, 'si', 'si.id = it.salesInvoiceId')
      .select('it.productName', 'name')
      .addSelect('COALESCE(SUM(it.netBeforeTax),0)', 'revenue')
      .addSelect('COALESCE(SUM(it.quantity),0)', 'qty')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('it.productName')
      .orderBy('revenue', 'DESC')
      .limit(7);
    this.scopeBranch(qb, 'si.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ name: string; revenue: string; qty: string }>();
    return rows.map((x) => ({ name: x.name, revenue: r2(n(x.revenue)), qty: r2(n(x.qty)) }));
  }

  private async topPurchaseProducts(range: Range, scope: BranchScope, branchId?: string) {
    const qb = this.purchaseItemRepo
      .createQueryBuilder('it')
      .innerJoin(PurchaseInvoice, 'pi', 'pi.id = it.purchaseInvoiceId')
      .select('it.productName', 'name')
      .addSelect('COALESCE(SUM(it.netBeforeTax),0)', 'cost')
      .addSelect('COALESCE(SUM(it.quantity),0)', 'qty')
      .where('pi.status = :st', { st: POSTED })
      .andWhere('pi.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('it.productName')
      .orderBy('cost', 'DESC')
      .limit(7);
    this.scopeBranch(qb, 'pi.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ name: string; cost: string; qty: string }>();
    return rows.map((x) => ({ name: x.name, cost: r2(n(x.cost)), qty: r2(n(x.qty)) }));
  }

  private async topCustomers(range: Range, scope: BranchScope, branchId?: string) {
    const qb = this.salesRepo
      .createQueryBuilder('si')
      .innerJoin('customers', 'c', 'c.id = si.customerId')
      .select('c.name', 'name')
      .addSelect('COALESCE(SUM(si.totalAmount),0)', 'total')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('c.id')
      .addGroupBy('c.name')
      .orderBy('total', 'DESC')
      .limit(7);
    this.scopeBranch(qb, 'si.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ name: string; total: string }>();
    return rows.map((x) => ({ name: x.name, total: r2(n(x.total)) }));
  }

  private async topSuppliers(range: Range, scope: BranchScope, branchId?: string) {
    const qb = this.purchaseRepo
      .createQueryBuilder('pi')
      .innerJoin('suppliers', 's', 's.id = pi.supplierId')
      .select('s.name', 'name')
      .addSelect('COALESCE(SUM(pi.totalAmount),0)', 'total')
      .where('pi.status = :st', { st: POSTED })
      .andWhere('pi.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('s.id')
      .addGroupBy('s.name')
      .orderBy('total', 'DESC')
      .limit(7);
    this.scopeBranch(qb, 'pi.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ name: string; total: string }>();
    return rows.map((x) => ({ name: x.name, total: r2(n(x.total)) }));
  }

  private async deliveryStatus(range: Range, scope: BranchScope, branchId?: string) {
    const qb = this.salesRepo
      .createQueryBuilder('si')
      .select('si.deliveryStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('si.status = :st', { st: POSTED })
      .andWhere('si.invoiceDate BETWEEN :from AND :to', { from: range.from, to: range.to })
      .groupBy('si.deliveryStatus');
    this.scopeBranch(qb, 'si.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = { pending: 0, partial: 0, delivered: 0, not_applicable: 0 };
    for (const x of rows) out[x.status] = n(x.count);
    return out;
  }

  private async recentSales(scope: BranchScope, branchId?: string) {
    const qb = this.salesRepo
      .createQueryBuilder('si')
      .leftJoin('customers', 'c', 'c.id = si.customerId')
      .select('si.invoiceNumber', 'number')
      .addSelect('si.invoiceDate', 'date')
      .addSelect('si.totalAmount', 'total')
      .addSelect('si.status', 'status')
      .addSelect('c.name', 'customer')
      .where('si.status = :st', { st: POSTED })
      .orderBy('si.invoiceDate', 'DESC')
      .addOrderBy('si.createdAt', 'DESC')
      .limit(8);
    this.scopeBranch(qb, 'si.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ number: string; date: string; total: string; status: string; customer: string }>();
    return rows.map((x) => ({ number: x.number, date: x.date, total: r2(n(x.total)), status: x.status, party: x.customer }));
  }

  private async recentPurchases(scope: BranchScope, branchId?: string) {
    const qb = this.purchaseRepo
      .createQueryBuilder('pi')
      .leftJoin('suppliers', 's', 's.id = pi.supplierId')
      .select('pi.invoiceNumber', 'number')
      .addSelect('pi.invoiceDate', 'date')
      .addSelect('pi.totalAmount', 'total')
      .addSelect('pi.status', 'status')
      .addSelect('s.name', 'supplier')
      .where('pi.status = :st', { st: POSTED })
      .orderBy('pi.invoiceDate', 'DESC')
      .addOrderBy('pi.createdAt', 'DESC')
      .limit(8);
    this.scopeBranch(qb, 'pi.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ number: string; date: string; total: string; status: string; supplier: string }>();
    return rows.map((x) => ({ number: x.number, date: x.date, total: r2(n(x.total)), status: x.status, party: x.supplier }));
  }

  // ── Balances (company-wide, as of now) ──
  private async receivables(): Promise<number> {
    const raw = await this.custTxnRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.debit - t.credit),0)', 'bal')
      .getRawOne<{ bal: string }>();
    return r2(n(raw?.bal));
  }

  private async payables(): Promise<number> {
    const raw = await this.suppTxnRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.credit - t.debit),0)', 'bal')
      .getRawOne<{ bal: string }>();
    return r2(n(raw?.bal));
  }

  private async cashOnHand(): Promise<number> {
    const [tre, bank] = await Promise.all([
      this.treasuryTxnRepo.createQueryBuilder('t').select('COALESCE(SUM(t.debit - t.credit),0)', 'bal').getRawOne<{ bal: string }>(),
      this.bankTxnRepo.createQueryBuilder('t').select('COALESCE(SUM(t.debit - t.credit),0)', 'bal').getRawOne<{ bal: string }>(),
    ]);
    return r2(n(tre?.bal) + n(bank?.bal));
  }

  private async cashFlow(range: Range): Promise<{ in: number; out: number }> {
    const q = (repo: Repository<TreasuryTransaction | BankTransaction>) =>
      repo
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.debit),0)', 'inflow')
        .addSelect('COALESCE(SUM(t.credit),0)', 'outflow')
        .where('t.transactionDate BETWEEN :from AND :to', { from: range.from, to: range.to })
        .getRawOne<{ inflow: string; outflow: string }>();
    const [tre, bank] = await Promise.all([q(this.treasuryTxnRepo), q(this.bankTxnRepo)]);
    return { in: r2(n(tre?.inflow) + n(bank?.inflow)), out: r2(n(tre?.outflow) + n(bank?.outflow)) };
  }

  private async topDebtors() {
    const rows = await this.custTxnRepo
      .createQueryBuilder('t')
      .innerJoin('customers', 'c', 'c.id = t.customerId')
      .select('c.name', 'name')
      .addSelect('SUM(t.debit - t.credit)', 'amount')
      .groupBy('c.id')
      .addGroupBy('c.name')
      .having('amount > 0')
      .orderBy('amount', 'DESC')
      .limit(7)
      .getRawMany<{ name: string; amount: string }>();
    return rows.map((x) => ({ name: x.name, amount: r2(n(x.amount)) }));
  }

  private async topCreditors() {
    const rows = await this.suppTxnRepo
      .createQueryBuilder('t')
      .innerJoin('suppliers', 's', 's.id = t.supplierId')
      .select('s.name', 'name')
      .addSelect('SUM(t.credit - t.debit)', 'amount')
      .groupBy('s.id')
      .addGroupBy('s.name')
      .having('amount > 0')
      .orderBy('amount', 'DESC')
      .limit(7)
      .getRawMany<{ name: string; amount: string }>();
    return rows.map((x) => ({ name: x.name, amount: r2(n(x.amount)) }));
  }

  // ── Inventory ──
  private async stockSummary(scope: BranchScope, branchId?: string) {
    const qb = this.stockRepo
      .createQueryBuilder('ws')
      .innerJoin('warehouses', 'w', 'w.id = ws.warehouseId')
      .innerJoin('products', 'p', 'p.id = ws.productId')
      .select('COALESCE(SUM(ws.quantity * ws.avgCost),0)', 'value')
      .addSelect('COUNT(DISTINCT ws.productId)', 'products')
      .addSelect('SUM(CASE WHEN ws.quantity <= 0 THEN 1 ELSE 0 END)', 'outOfStock')
      .addSelect('SUM(CASE WHEN p.reorderPoint > 0 AND ws.quantity <= p.reorderPoint AND ws.quantity > 0 THEN 1 ELSE 0 END)', 'lowStock');
    this.scopeBranch(qb, 'w.branchId', scope, branchId);
    const raw = await qb.getRawOne<{ value: string; products: string; outOfStock: string; lowStock: string }>();
    return {
      stockValue: r2(n(raw?.value)),
      distinctProducts: n(raw?.products),
      lowStockCount: n(raw?.lowStock),
      outOfStockCount: n(raw?.outOfStock),
    };
  }

  private async lowStock(scope: BranchScope, branchId?: string) {
    const qb = this.stockRepo
      .createQueryBuilder('ws')
      .innerJoin('warehouses', 'w', 'w.id = ws.warehouseId')
      .innerJoin('products', 'p', 'p.id = ws.productId')
      .select('p.name', 'product')
      .addSelect('p.code', 'code')
      .addSelect('w.name', 'warehouse')
      .addSelect('ws.quantity', 'quantity')
      .addSelect('p.reorderPoint', 'reorderPoint')
      .where('p.reorderPoint > 0 AND ws.quantity <= p.reorderPoint')
      .orderBy('(ws.quantity - p.reorderPoint)', 'ASC')
      .limit(12);
    this.scopeBranch(qb, 'w.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ product: string; code: string; warehouse: string; quantity: string; reorderPoint: string }>();
    return rows.map((x) => ({ product: x.product, code: x.code, warehouse: x.warehouse, quantity: r2(n(x.quantity)), reorderPoint: r2(n(x.reorderPoint)) }));
  }

  private async stockValueByWarehouse(scope: BranchScope, branchId?: string) {
    const qb = this.stockRepo
      .createQueryBuilder('ws')
      .innerJoin('warehouses', 'w', 'w.id = ws.warehouseId')
      .select('w.name', 'warehouse')
      .addSelect('COALESCE(SUM(ws.quantity * ws.avgCost),0)', 'value')
      .groupBy('w.id')
      .addGroupBy('w.name')
      .orderBy('value', 'DESC');
    this.scopeBranch(qb, 'w.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ warehouse: string; value: string }>();
    return rows.map((x) => ({ warehouse: x.warehouse, value: r2(n(x.value)) })).filter((x) => x.value !== 0);
  }

  private async manufacturingByStatus(scope: BranchScope, branchId?: string) {
    const qb = this.moRepo
      .createQueryBuilder('mo')
      .select('mo.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('mo.status');
    this.scopeBranch(qb, 'mo.branchId', scope, branchId);
    const rows = await qb.getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = { new: 0, in_progress: 0, done: 0, cancelled: 0 };
    for (const x of rows) out[x.status] = n(x.count);
    return out;
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private scopeBranch(qb: SelectQueryBuilder<ObjectLiteral>, column: string, scope: BranchScope, branchId?: string): void {
    applyBranchScope(qb, column, scope);
    if (branchId) qb.andWhere(`${column} = :explicitBranch`, { explicitBranch: branchId });
  }

  private delta(value: number, prev: number): Delta {
    const changePct = prev > 0 ? r2(((value - prev) / prev) * 100) : null;
    return { value: r2(value), prev: r2(prev), changePct };
  }

  private resolveRange(q: DashboardQueryDto): Range {
    const today = new Date();
    const from = q.dateFrom ?? this.iso(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = q.dateTo ?? this.iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    const fromD = new Date(from + 'T00:00:00');
    const toD = new Date(to + 'T00:00:00');
    const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    const prevTo = new Date(fromD.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
    return {
      from,
      to,
      prevFrom: this.iso(prevFrom),
      prevTo: this.iso(prevTo),
      bucket: days > 62 ? 'month' : 'day',
    };
  }

  private iso(d: Date): string {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
