import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { Product } from '../product/entities/product.entity';
import { ProductImage } from '../product/entities/product-image.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { Customer } from '../customer/entities/customer.entity';
import { CustomerLedgerService } from '../customer/customer-ledger.service';
import { CUSTOMER_TRANSACTION_TYPE_LABELS, CustomerTransactionType } from '../customer/enums/customer-transaction.enum';
import { AppFeature, appFeaturesOf } from './attendance.enum';
import { AppListQueryDto } from './dto/leave.dto';

const PAGE = 20;

/**
 * «بوابة الموظف» read-only views: the product catalog (price / stock only when
 * allowed — cost NEVER) and customer balances. Scoped to the employee's branches
 * (no branches = all branches).
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: CustomerLedgerService,
  ) {}

  /** The employee's branch ids, or null when they serve every branch. */
  async branchIdsOf(employeeId: string): Promise<string[] | null> {
    const rows: { branch_id: string }[] = await this.dataSource.query('SELECT branch_id FROM employee_branches WHERE employee_id = ?', [employeeId]);
    return rows.length ? rows.map((r) => r.branch_id) : null;
  }

  private async warehousesOf(employeeId: string): Promise<Warehouse[]> {
    const branches = await this.branchIdsOf(employeeId);
    const qb = this.dataSource.getRepository(Warehouse).createQueryBuilder('w').where('w.isActive = 1');
    if (branches) qb.andWhere('w.branchId IN (:...b)', { b: branches });
    return qb.orderBy('w.name', 'ASC').getMany();
  }

  categories() {
    return this.dataSource
      .getRepository(ProductCategory)
      .createQueryBuilder('c')
      .select(['c.id', 'c.name'])
      .orderBy('c.name', 'ASC')
      .getMany();
  }

  // ── products ─────────────────────────────────────────
  async products(e: Employee, q: AppListQueryDto) {
    const f = appFeaturesOf(e);
    const showPrice = f.includes(AppFeature.PRICES);
    const showStock = f.includes(AppFeature.STOCK);
    const page = q.page ?? 1;
    const warehouses = showStock || q.inStock ? await this.warehousesOf(e.id) : [];
    const whIds = warehouses.map((w) => w.id);

    const qb = this.dataSource
      .getRepository(Product)
      .createQueryBuilder('p')
      .leftJoin('p.category', 'c')
      .leftJoin('p.unit', 'u')
      .select(['p.id', 'p.code', 'p.barcode', 'p.name', 'p.sellingPrice', 'p.trackInventory', 'c.id', 'c.name', 'u.id', 'u.name'])
      .where('p.isActive = 1');
    if (q.search?.trim()) {
      qb.andWhere('(p.name LIKE :s OR p.code LIKE :s OR p.barcode = :exact OR p.nameEn LIKE :s)', { s: `%${q.search.trim()}%`, exact: q.search.trim() });
    }
    if (q.categoryId) qb.andWhere('p.categoryId = :cat', { cat: q.categoryId });
    if (q.inStock) {
      if (!whIds.length) qb.andWhere('1 = 0');
      else
        qb.andWhere('EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = p.id AND ws.warehouse_id IN (:...wh) AND ws.quantity - ws.reserved_quantity > 0)', { wh: whIds });
    }
    qb.orderBy('p.name', 'ASC').skip((page - 1) * PAGE).take(PAGE);
    const [items, total] = await qb.getManyAndCount();

    const ids = items.map((p) => p.id);
    const [images, stock] = await Promise.all([this.primaryImages(ids), showStock ? this.stockOf(ids, whIds) : Promise.resolve(new Map<string, number>())]);
    return {
      page,
      hasMore: page * PAGE < total,
      total,
      showPrice,
      showStock,
      items: items.map((p) => ({
        id: p.id,
        code: p.code,
        barcode: p.barcode,
        name: p.name,
        categoryName: p.category?.name ?? null,
        unitName: p.unit?.name ?? null,
        imageUrl: images.get(p.id) ?? null,
        sellingPrice: showPrice ? Number(p.sellingPrice) : undefined,
        available: showStock && p.trackInventory ? (stock.get(p.id) ?? 0) : undefined,
      })),
    };
  }

  async product(e: Employee, id: string) {
    const f = appFeaturesOf(e);
    const showPrice = f.includes(AppFeature.PRICES);
    const showStock = f.includes(AppFeature.STOCK);
    const p = await this.dataSource
      .getRepository(Product)
      .createQueryBuilder('p')
      .leftJoin('p.category', 'c')
      .leftJoin('p.unit', 'u')
      .leftJoin('p.brand', 'b')
      .select(['p.id', 'p.code', 'p.barcode', 'p.name', 'p.description', 'p.sellingPrice', 'p.trackInventory', 'c.id', 'c.name', 'u.id', 'u.name', 'b.id', 'b.name'])
      .where('p.id = :id AND p.isActive = 1', { id })
      .getOne();
    if (!p) throw new NotFoundException('لم يتم العثور على المنتج');
    const images = await this.dataSource.getRepository(ProductImage).find({ where: { productId: id }, order: { isPrimary: 'DESC', displayOrder: 'ASC' } });

    let warehouses: { id: string; name: string; quantity: number; reserved: number; available: number }[] | undefined;
    if (showStock && p.trackInventory) {
      const whs = await this.warehousesOf(e.id);
      const rows = whs.length
        ? await this.dataSource.getRepository(WarehouseStock).createQueryBuilder('s').where('s.productId = :id', { id }).andWhere('s.warehouseId IN (:...w)', { w: whs.map((w) => w.id) }).getMany()
        : [];
      warehouses = whs.map((w) => {
        const r = rows.find((x) => x.warehouseId === w.id);
        const qty = Number(r?.quantity ?? 0);
        const res = Number(r?.reservedQuantity ?? 0);
        return { id: w.id, name: w.name, quantity: qty, reserved: res, available: Math.max(0, qty - res) };
      });
    }
    return {
      id: p.id,
      code: p.code,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      categoryName: p.category?.name ?? null,
      brandName: p.brand?.name ?? null,
      unitName: p.unit?.name ?? null,
      images: images.map((i) => i.url),
      sellingPrice: showPrice ? Number(p.sellingPrice) : undefined,
      trackInventory: p.trackInventory,
      warehouses,
      available: warehouses?.reduce((a, w) => a + w.available, 0),
    };
  }

  private async primaryImages(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = await this.dataSource
      .getRepository(ProductImage)
      .createQueryBuilder('i')
      .where('i.productId IN (:...ids)', { ids })
      .orderBy('i.isPrimary', 'DESC')
      .addOrderBy('i.displayOrder', 'ASC')
      .getMany();
    for (const r of rows) if (!out.has(r.productId)) out.set(r.productId, r.url);
    return out;
  }

  /** Available (on hand − reserved) per product across the given warehouses. */
  private async stockOf(ids: string[], whIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length || !whIds.length) return out;
    const rows: { product_id: string; available: string }[] = await this.dataSource.query(
      `SELECT product_id, SUM(GREATEST(quantity - reserved_quantity, 0)) AS available FROM warehouse_stock
       WHERE product_id IN (${ids.map(() => '?').join(',')}) AND warehouse_id IN (${whIds.map(() => '?').join(',')}) GROUP BY product_id`,
      [...ids, ...whIds],
    );
    for (const r of rows) out.set(r.product_id, Number(r.available));
    return out;
  }

  // ── customers ────────────────────────────────────────
  /** Customers of the employee's branches = customers with a posted sales invoice in one of them. */
  private async customersQuery(employeeId: string) {
    const branches = await this.branchIdsOf(employeeId);
    const qb = this.dataSource.getRepository(Customer).createQueryBuilder('c').where('c.isActive = 1');
    if (branches) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM sales_invoices si WHERE si.customer_id = c.id AND si.branch_id IN (:...cb) AND si.status = 'posted' AND si.deleted_at IS NULL)`,
        { cb: branches },
      );
    }
    return qb;
  }

  async customers(e: Employee, q: AppListQueryDto) {
    const page = q.page ?? 1;
    const qb = await this.customersQuery(e.id);
    if (q.search?.trim()) qb.andWhere('(c.name LIKE :s OR c.code LIKE :s OR c.mobile LIKE :s OR c.phone LIKE :s)', { s: `%${q.search.trim()}%` });
    qb.select(['c.id', 'c.code', 'c.name', 'c.mobile', 'c.creditLimit']).orderBy('c.name', 'ASC').skip((page - 1) * PAGE).take(PAGE);
    const [items, total] = await qb.getManyAndCount();
    const balances = await this.ledger.balances(items.map((c) => c.id));
    return {
      page,
      hasMore: page * PAGE < total,
      total,
      items: items.map((c) => ({ id: c.id, code: c.code, name: c.name, mobile: c.mobile, balance: balances.get(c.id) ?? 0, creditLimit: Number(c.creditLimit) || 0 })),
    };
  }

  async customer(e: Employee, id: string) {
    const qb = await this.customersQuery(e.id);
    const c = await qb.andWhere('c.id = :id', { id }).getOne();
    if (!c) throw new NotFoundException('لم يتم العثور على العميل');
    const st = await this.ledger.statement(id);
    const rows = st.transactions.filter((t) => !t.reversalPairId).slice(0, 30);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      mobile: c.mobile,
      phone: c.phone,
      address: c.address,
      city: c.city,
      creditLimit: Number(c.creditLimit) || 0,
      balance: st.balance,
      transactions: rows.map((t) => ({
        id: t.id,
        date: t.transactionDate,
        type: t.type,
        typeLabel: CUSTOMER_TRANSACTION_TYPE_LABELS[t.type as CustomerTransactionType] ?? t.type,
        number: t.sourceNumber,
        description: t.description,
        debit: Number(t.debit) || 0,
        credit: Number(t.credit) || 0,
      })),
    };
  }
}
