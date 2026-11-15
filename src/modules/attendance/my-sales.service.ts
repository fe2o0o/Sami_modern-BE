import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeCommissionReportService } from '../employee/employee-commission-report.service';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { cairoToday } from './attendance-time.util';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

export interface MySalesInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  customerName: string | null;
  branchName: string | null;
  /** Net of discount, before VAT. */
  salesAmount: number;
  totalAmount: number;
  /** Sales value taken back by posted returns on this invoice (any date). */
  returnedAmount: number;
  deliveryStatus: string;
  sharedWith: string[];
  lines: { productName: string | null; productCode: string | null; unitName: string | null; lineType: string; quantity: number; deliveredQuantity: number; unitPrice: number; netAmount: number }[];
}

/**
 * «مبيعاتي» in the employee portal: the employee's own sales (invoices where they
 * are a sales employee) — customers, quantities, prices, delivery status.
 * Built on the commissions report, with EVERY commission figure removed: no
 * commission amount, rate or type ever leaves this service.
 */
@Injectable()
export class MySalesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly commissions: EmployeeCommissionReportService,
  ) {}

  private range(from?: string, to?: string): { dateFrom: string; dateTo: string } {
    const today = cairoToday();
    const dateFrom = (from ?? `${today.slice(0, 7)}-01`).slice(0, 10);
    const dateTo = (to ?? today).slice(0, 10);
    if (dateFrom > dateTo) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    return { dateFrom, dateTo };
  }

  /**
   * One employee's sales. `scope` = the VIEWER's branches when looking at a
   * colleague («مبيعات كل الموظفين»); null for the employee's own sales.
   */
  async mySales(employee: Employee, from?: string, to?: string, scope: string[] | null = null) {
    const { dateFrom, dateTo } = this.range(from, to);
    const d = await this.commissions.details(employee.id, { dateFrom, dateTo } as never, scope);
    // Posted only (drafts are not sales yet); one row per invoice.
    const seen = new Set<string>();
    const posted = d.invoices.filter((i) => i.status === SalesInvoiceStatus.POSTED && !seen.has(i.invoiceId) && seen.add(i.invoiceId));

    // Sales value returned per invoice (returnedBase of the posted returns, any date).
    const returnedByInvoice = new Map<string, number>();
    for (const r of d.returns) returnedByInvoice.set(r.invoiceId, round2((returnedByInvoice.get(r.invoiceId) ?? 0) + r.returnedBase));

    const ids = posted.map((i) => i.invoiceId);
    const items = ids.length
      ? await this.dataSource.getRepository(SalesInvoiceItem).find({
          where: { salesInvoiceId: In(ids) },
          order: { lineNumber: 'ASC' },
          select: {
            salesInvoiceId: true, productName: true, productCode: true, unitName: true, lineType: true,
            quantity: true, deliveredQuantity: true, unitPrice: true, netBeforeTax: true,
          },
        })
      : [];
    const linesBy = new Map<string, MySalesInvoice['lines']>();
    for (const it of items) {
      const list = linesBy.get(it.salesInvoiceId) ?? [];
      list.push({
        productName: it.productName ?? null,
        productCode: it.productCode ?? null,
        unitName: it.unitName ?? null,
        lineType: String(it.lineType),
        quantity: round3(Number(it.quantity) || 0),
        deliveredQuantity: round3(Number(it.deliveredQuantity) || 0),
        unitPrice: round2(Number(it.unitPrice) || 0),
        netAmount: round2(Number(it.netBeforeTax) || 0),
      });
      linesBy.set(it.salesInvoiceId, list);
    }

    const invoices: MySalesInvoice[] = posted.map((i) => ({
      invoiceId: i.invoiceId,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      customerName: i.customerName,
      branchName: i.branchName,
      salesAmount: i.taxableAmount,
      totalAmount: i.totalAmount,
      returnedAmount: returnedByInvoice.get(i.invoiceId) ?? 0,
      deliveryStatus: i.deliveryStatus,
      sharedWith: i.sharedWith,
      lines: linesBy.get(i.invoiceId) ?? [],
    }));

    const totalSales = round2(invoices.reduce((s, i) => s + i.salesAmount, 0));
    // Returns posted IN the period (by return date) — the same rule as the ERP report.
    const returns = round2(d.returns.reduce((s, r) => s + r.returnedBase, 0));
    const quantity = round3(d.products.reduce((s, p) => s + p.quantity, 0));

    return {
      period: { from: dateFrom, to: dateTo },
      employee: { id: employee.id, name: employee.name, code: employee.code ?? null, jobTitle: employee.jobTitle ?? null },
      summary: {
        invoicesCount: invoices.length,
        totalSales,
        returns,
        netSales: round2(totalSales - returns),
        quantity,
        customersCount: d.customers.length,
        avgInvoice: invoices.length ? round2(totalSales / invoices.length) : 0,
        drafts: d.summary.draftInvoices,
      },
      byMonth: d.byMonth.map((m) => ({ month: m.month, invoicesCount: m.invoicesCount, totalSales: m.totalSales })),
      delivery: d.delivery,
      invoices,
      customers: d.customers.map((c) => ({ customerId: c.customerId, customerName: c.customerName, invoicesCount: c.invoicesCount, totalSales: c.totalSales, lastInvoiceDate: c.lastInvoiceDate })),
      products: d.products.map((p) => ({
        productId: p.productId, productCode: p.productCode, productName: p.productName, unitName: p.unitName, lineType: p.lineType,
        invoicesCount: p.invoicesCount, quantity: p.quantity, deliveredQuantity: p.deliveredQuantity, totalSales: p.totalSales,
      })),
      returnsList: d.returns.map((r) => ({ returnNumber: r.returnNumber, returnDate: r.returnDate, invoiceNumber: r.invoiceNumber, customerName: r.customerName, amount: r.returnedBase })),
    };
  }

  /**
   * «مبيعات كل الموظفين»: sales per sales employee in the period, limited to the
   * viewer's branches (null = all). Commission figures are dropped.
   */
  async team(from: string | undefined, to: string | undefined, scope: string[] | null) {
    const { dateFrom, dateTo } = this.range(from, to);
    const r = await this.commissions.generate({ dateFrom, dateTo } as never, scope);
    const rows = r.rows
      .map((x) => ({ employeeId: x.employeeId, employeeName: x.employeeName, invoicesCount: x.invoicesCount, totalSales: round2(x.totalSales) }))
      .sort((a, b) => b.totalSales - a.totalSales);
    const totalSales = round2(rows.reduce((s, x) => s + x.totalSales, 0));
    return {
      period: { from: dateFrom, to: dateTo },
      summary: {
        employeesCount: rows.length,
        // An invoice shared by two employees counts for both (same rule as the ERP report).
        invoicesCount: rows.reduce((s, x) => s + x.invoicesCount, 0),
        totalSales,
      },
      rows: rows.map((x) => ({ ...x, sharePct: totalSales > 0 ? round2((x.totalSales / totalSales) * 100) : 0 })),
    };
  }

  /** Home card: this month's sales (count + value). */
  async monthCard(employee: Employee) {
    const s = await this.mySales(employee);
    return { invoicesCount: s.summary.invoicesCount, totalSales: s.summary.totalSales, netSales: s.summary.netSales };
  }
}
