import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesCommissionType, SalesDeliveryStatus, SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesDelivery } from '../sales-delivery/entities/sales-delivery.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Branch } from '../branch/entities/branch.entity';
import { Employee } from './entities/employee.entity';
import { applyBranchScope, BranchScope } from '../../common/utils/branch-scope.util';
import { CommissionReportQueryDto } from './dto/commission-report-query.dto';

export interface CommissionReportRow {
  employeeId: string;
  employeeName: string | null;
  invoicesCount: number;
  /** Taxable sales of the invoices the employee earned commission on. */
  totalSales: number;
  totalCommission: number;
  /** Mean of the percentage entered on the employee's percentage lines (null if none). */
  avgRate: number | null;
  /** Commission ÷ sales × 100 — covers fixed-amount lines too. */
  effectiveRate: number | null;
  percentageLines: number;
  fixedLines: number;
}

export interface CommissionReport {
  period: { from: string; to: string };
  rows: CommissionReportRow[];
  total: number;
  totalSales: number;
}

export interface EmployeeCommissionInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  status: SalesInvoiceStatus;
  customerName: string | null;
  branchName: string | null;
  paymentType: string;
  taxableAmount: number;
  totalAmount: number;
  commissionType: SalesCommissionType;
  /** Percentage entered (percentage lines) or fixed amount (fixed lines). */
  value: number;
  amount: number;
  /** Commission ÷ invoice taxable amount × 100. */
  effectiveRate: number | null;
  /** Other employees sharing commission on the same invoice. */
  sharedWith: string[];
  customerId: string | null;
  /** Delivery progress of the invoice's stock lines. */
  deliveryStatus: SalesDeliveryStatus;
  /** Delivery notes issued against the invoice (draft / posted / reversed). */
  deliveries: { id: string; number: string | null; date: string; status: string }[];
}

export interface EmployeeCommissionCustomer {
  customerId: string | null;
  customerName: string | null;
  invoicesCount: number;
  totalSales: number;
  totalCommission: number;
  lastInvoiceDate: string;
}

export interface EmployeeCommissionProduct {
  productId: string;
  productCode: string | null;
  productName: string | null;
  unitName: string | null;
  lineType: string;
  invoicesCount: number;
  quantity: number;
  deliveredQuantity: number;
  /** Net sales before VAT for this product on the employee's invoices. */
  totalSales: number;
}

export interface EmployeeCommissionDetails {
  period: { from: string; to: string };
  employee: { id: string; code: string | null; name: string; jobTitle: string | null; commissionRate: number | null };
  /** Totals over POSTED invoices only (drafts are listed but not counted). */
  summary: Omit<CommissionReportRow, 'employeeId' | 'employeeName'> & { draftInvoices: number; draftCommission: number };
  byMonth: { month: string; invoicesCount: number; totalSales: number; totalCommission: number }[];
  invoices: EmployeeCommissionInvoice[];
  /** Posted invoices only. */
  customers: EmployeeCommissionCustomer[];
  products: EmployeeCommissionProduct[];
  /** Posted invoices by delivery progress. */
  delivery: Record<SalesDeliveryStatus, number>;
}

interface LineRaw {
  employeeId: string;
  employeeName: string | null;
  invoiceId: string;
  commissionType: SalesCommissionType;
  value: string;
  amount: string;
  taxableAmount: string;
}

/** Raw DATE columns come back as Date objects (local midnight) — format as YYYY-MM-DD. */
function toYmd(v: unknown): string {
  if (v instanceof Date) {
    const m = `${v.getMonth() + 1}`.padStart(2, '0');
    const d = `${v.getDate()}`.padStart(2, '0');
    return `${v.getFullYear()}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Aggregate commission lines (one employee) into report figures. */
function aggregate(lines: { invoiceId: string; commissionType: SalesCommissionType; value: number; amount: number; taxableAmount: number }[]) {
  const invoices = new Map<string, number>();
  let totalCommission = 0;
  const pct: number[] = [];
  let fixedLines = 0;
  for (const l of lines) {
    invoices.set(l.invoiceId, l.taxableAmount);
    totalCommission += l.amount;
    if (l.commissionType === SalesCommissionType.PERCENTAGE) pct.push(l.value);
    else fixedLines++;
  }
  const totalSales = [...invoices.values()].reduce((s, v) => s + v, 0);
  return {
    invoicesCount: invoices.size,
    totalSales: round2(totalSales),
    totalCommission: round2(totalCommission),
    avgRate: pct.length ? round2(pct.reduce((s, v) => s + v, 0) / pct.length) : null,
    effectiveRate: totalSales > 0 ? round2((totalCommission / totalSales) * 100) : null,
    percentageLines: pct.length,
    fixedLines,
  };
}

/**
 * Employee sales-commission report — per-employee totals from the commission
 * lines of POSTED sales invoices within a date range, plus a per-employee
 * drill-down. Read-only; restricted to the caller's branch scope.
 */
@Injectable()
export class EmployeeCommissionReportService {
  constructor(
    @InjectRepository(SalesInvoiceCommission)
    private readonly commissionRepository: Repository<SalesInvoiceCommission>,
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
  ) {}

  async generate(query: CommissionReportQueryDto, branchScope: BranchScope = null): Promise<CommissionReport> {
    const qb = this.commissionRepository
      .createQueryBuilder('c')
      .innerJoin(SalesInvoice, 'si', 'si.id = c.salesInvoiceId')
      .select('c.employeeId', 'employeeId')
      .addSelect('c.employeeName', 'employeeName')
      .addSelect('c.salesInvoiceId', 'invoiceId')
      .addSelect('c.commissionType', 'commissionType')
      .addSelect('c.value', 'value')
      .addSelect('c.amount', 'amount')
      .addSelect('si.taxableAmount', 'taxableAmount')
      .where('si.status = :posted', { posted: SalesInvoiceStatus.POSTED })
      .andWhere('si.invoiceDate >= :from', { from: query.dateFrom })
      .andWhere('si.invoiceDate <= :to', { to: query.dateTo });
    if (query.employeeId) qb.andWhere('c.employeeId = :eid', { eid: query.employeeId });
    applyBranchScope(qb, 'si.branchId', branchScope);

    const raw = await qb.getRawMany<LineRaw>();
    const byEmployee = new Map<string, { name: string | null; lines: LineRaw[] }>();
    for (const r of raw) {
      const e = byEmployee.get(r.employeeId) ?? { name: r.employeeName, lines: [] };
      e.name = e.name ?? r.employeeName;
      e.lines.push(r);
      byEmployee.set(r.employeeId, e);
    }

    const rows: CommissionReportRow[] = [...byEmployee.entries()]
      .map(([employeeId, e]) => ({
        employeeId,
        employeeName: e.name,
        ...aggregate(
          e.lines.map((l) => ({
            invoiceId: l.invoiceId,
            commissionType: l.commissionType,
            value: Number(l.value),
            amount: Number(l.amount),
            taxableAmount: Number(l.taxableAmount),
          })),
        ),
      }))
      .sort((a, b) => b.totalCommission - a.totalCommission);

    const total = round2(rows.reduce((s, r) => s + r.totalCommission, 0));
    // Sales of distinct invoices across everyone (an invoice shared by two reps counts once).
    const invoiceSales = new Map(raw.map((r) => [r.invoiceId, Number(r.taxableAmount)]));
    const totalSales = round2([...invoiceSales.values()].reduce((s, v) => s + v, 0));

    return { period: { from: query.dateFrom, to: query.dateTo }, rows, total, totalSales };
  }

  /** Everything one employee earned commission on in the period (posted + drafts). */
  async details(
    employeeId: string,
    query: CommissionReportQueryDto,
    branchScope: BranchScope = null,
  ): Promise<EmployeeCommissionDetails> {
    const employee = await this.employeeRepository.findOne({ where: { id: employeeId }, withDeleted: true });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const qb = this.commissionRepository
      .createQueryBuilder('c')
      .innerJoin(SalesInvoice, 'si', 'si.id = c.salesInvoiceId')
      .leftJoin(Customer, 'cu', 'cu.id = si.customerId')
      .leftJoin(Branch, 'br', 'br.id = si.branchId')
      .select('si.id', 'invoiceId')
      .addSelect('si.invoiceNumber', 'invoiceNumber')
      .addSelect('si.invoiceDate', 'invoiceDate')
      .addSelect('si.status', 'status')
      .addSelect('si.paymentType', 'paymentType')
      .addSelect('si.taxableAmount', 'taxableAmount')
      .addSelect('si.totalAmount', 'totalAmount')
      .addSelect('si.customerId', 'customerId')
      .addSelect('si.deliveryStatus', 'deliveryStatus')
      .addSelect('cu.name', 'customerName')
      .addSelect('br.name', 'branchName')
      .addSelect('c.commissionType', 'commissionType')
      .addSelect('c.value', 'value')
      .addSelect('c.amount', 'amount')
      .where('c.employeeId = :eid', { eid: employeeId })
      .andWhere('si.status IN (:...statuses)', { statuses: [SalesInvoiceStatus.POSTED, SalesInvoiceStatus.DRAFT] })
      .andWhere('si.invoiceDate >= :from', { from: query.dateFrom })
      .andWhere('si.invoiceDate <= :to', { to: query.dateTo })
      .orderBy('si.invoiceDate', 'DESC')
      .addOrderBy('si.invoiceNumber', 'DESC');
    applyBranchScope(qb, 'si.branchId', branchScope);
    const raw = await qb.getRawMany<Record<string, unknown>>();

    // Co-earners on the same invoices.
    const invoiceIds = [...new Set(raw.map((r) => String(r.invoiceId)))];
    const others = invoiceIds.length
      ? await this.commissionRepository
          .createQueryBuilder('c')
          .select(['c.salesInvoiceId AS invoiceId', 'c.employeeName AS employeeName'])
          .where('c.salesInvoiceId IN (:...ids)', { ids: invoiceIds })
          .andWhere('c.employeeId != :eid', { eid: employeeId })
          .getRawMany<{ invoiceId: string; employeeName: string | null }>()
      : [];
    // Delivery notes per invoice.
    const deliveryRows = invoiceIds.length
      ? await this.commissionRepository.manager
          .createQueryBuilder(SalesDelivery, 'd')
          .select(['d.id AS id', 'd.deliveryNumber AS number', 'd.deliveryDate AS date', 'd.status AS status', 'd.salesInvoiceId AS invoiceId'])
          .where('d.salesInvoiceId IN (:...ids)', { ids: invoiceIds })
          .orderBy('d.deliveryDate', 'ASC')
          .getRawMany<{ id: string; number: string | null; date: unknown; status: string; invoiceId: string }>()
      : [];
    const deliveriesMap = new Map<string, EmployeeCommissionInvoice['deliveries']>();
    for (const d of deliveryRows) {
      const list = deliveriesMap.get(d.invoiceId) ?? [];
      list.push({ id: d.id, number: d.number, date: toYmd(d.date), status: d.status });
      deliveriesMap.set(d.invoiceId, list);
    }

    const sharedMap = new Map<string, string[]>();
    for (const o of others) {
      const list = sharedMap.get(o.invoiceId) ?? [];
      if (o.employeeName && !list.includes(o.employeeName)) list.push(o.employeeName);
      sharedMap.set(o.invoiceId, list);
    }

    const invoices: EmployeeCommissionInvoice[] = raw.map((r) => {
      const taxable = Number(r.taxableAmount);
      const amount = Number(r.amount);
      const invoiceId = String(r.invoiceId);
      return {
        invoiceId,
        invoiceNumber: (r.invoiceNumber as string | null) ?? null,
        invoiceDate: toYmd(r.invoiceDate),
        status: r.status as SalesInvoiceStatus,
        customerName: (r.customerName as string | null) ?? null,
        branchName: (r.branchName as string | null) ?? null,
        paymentType: String(r.paymentType),
        taxableAmount: round2(taxable),
        totalAmount: round2(Number(r.totalAmount)),
        commissionType: r.commissionType as SalesCommissionType,
        value: round2(Number(r.value)),
        amount: round2(amount),
        effectiveRate: taxable > 0 ? round2((amount / taxable) * 100) : null,
        sharedWith: sharedMap.get(invoiceId) ?? [],
        customerId: (r.customerId as string | null) ?? null,
        deliveryStatus: (r.deliveryStatus as SalesDeliveryStatus) ?? SalesDeliveryStatus.NOT_APPLICABLE,
        deliveries: deliveriesMap.get(invoiceId) ?? [],
      };
    });

    const posted = invoices.filter((i) => i.status === SalesInvoiceStatus.POSTED);
    const drafts = invoices.filter((i) => i.status === SalesInvoiceStatus.DRAFT);
    const summary = {
      ...aggregate(posted.map((i) => ({ invoiceId: i.invoiceId, commissionType: i.commissionType, value: i.value, amount: i.amount, taxableAmount: i.taxableAmount }))),
      draftInvoices: new Set(drafts.map((d) => d.invoiceId)).size,
      draftCommission: round2(drafts.reduce((s, d) => s + d.amount, 0)),
    };

    const months = new Map<string, { invoices: Set<string>; sales: Map<string, number>; commission: number }>();
    for (const i of posted) {
      const key = i.invoiceDate.slice(0, 7);
      const m = months.get(key) ?? { invoices: new Set<string>(), sales: new Map<string, number>(), commission: 0 };
      m.invoices.add(i.invoiceId);
      m.sales.set(i.invoiceId, i.taxableAmount);
      m.commission += i.amount;
      months.set(key, m);
    }
    const byMonth = [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        invoicesCount: m.invoices.size,
        totalSales: round2([...m.sales.values()].reduce((s, v) => s + v, 0)),
        totalCommission: round2(m.commission),
      }));

    // Customers (posted invoices).
    const customerMap = new Map<string, EmployeeCommissionCustomer & { ids: Set<string> }>();
    for (const i of posted) {
      const key = i.customerId ?? '—';
      const c = customerMap.get(key) ?? {
        customerId: i.customerId,
        customerName: i.customerName,
        invoicesCount: 0,
        totalSales: 0,
        totalCommission: 0,
        lastInvoiceDate: i.invoiceDate,
        ids: new Set<string>(),
      };
      if (!c.ids.has(i.invoiceId)) {
        c.ids.add(i.invoiceId);
        c.totalSales += i.taxableAmount;
      }
      c.totalCommission += i.amount;
      if (i.invoiceDate > c.lastInvoiceDate) c.lastInvoiceDate = i.invoiceDate;
      customerMap.set(key, c);
    }
    const customers: EmployeeCommissionCustomer[] = [...customerMap.values()]
      .map(({ ids, ...c }) => ({ ...c, invoicesCount: ids.size, totalSales: round2(c.totalSales), totalCommission: round2(c.totalCommission) }))
      .sort((a, b) => b.totalSales - a.totalSales);

    // Products sold on the employee's posted invoices.
    const postedIds = [...new Set(posted.map((i) => i.invoiceId))];
    const itemRows = postedIds.length
      ? await this.commissionRepository.manager
          .createQueryBuilder(SalesInvoiceItem, 'it')
          .select('it.productId', 'productId')
          .addSelect('MAX(it.productCode)', 'productCode')
          .addSelect('MAX(it.productName)', 'productName')
          .addSelect('MAX(it.unitName)', 'unitName')
          .addSelect('MAX(it.lineType)', 'lineType')
          .addSelect('COUNT(DISTINCT it.salesInvoiceId)', 'invoicesCount')
          .addSelect('SUM(it.quantity)', 'quantity')
          .addSelect('SUM(it.deliveredQuantity)', 'deliveredQuantity')
          .addSelect('SUM(it.netBeforeTax)', 'totalSales')
          .where('it.salesInvoiceId IN (:...ids)', { ids: postedIds })
          .groupBy('it.productId')
          .orderBy('totalSales', 'DESC')
          .getRawMany<Record<string, string>>()
      : [];
    const products: EmployeeCommissionProduct[] = itemRows.map((r) => ({
      productId: r.productId,
      productCode: r.productCode ?? null,
      productName: r.productName ?? null,
      unitName: r.unitName ?? null,
      lineType: r.lineType,
      invoicesCount: Number(r.invoicesCount),
      quantity: round2(Number(r.quantity)),
      deliveredQuantity: round2(Number(r.deliveredQuantity)),
      totalSales: round2(Number(r.totalSales)),
    }));

    const delivery = {
      [SalesDeliveryStatus.NOT_APPLICABLE]: 0,
      [SalesDeliveryStatus.PENDING]: 0,
      [SalesDeliveryStatus.PARTIAL]: 0,
      [SalesDeliveryStatus.DELIVERED]: 0,
    } as Record<SalesDeliveryStatus, number>;
    const seen = new Set<string>();
    for (const i of posted) {
      if (seen.has(i.invoiceId)) continue;
      seen.add(i.invoiceId);
      delivery[i.deliveryStatus] = (delivery[i.deliveryStatus] ?? 0) + 1;
    }

    return {
      period: { from: query.dateFrom, to: query.dateTo },
      customers,
      products,
      delivery,
      employee: {
        id: employee.id,
        code: employee.code ?? null,
        name: employee.name,
        jobTitle: employee.jobTitle ?? null,
        commissionRate: employee.commissionRate != null ? Number(employee.commissionRate) : null,
      },
      summary,
      byMonth,
      invoices,
    };
  }
}
