import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { CommissionReportQueryDto } from './dto/commission-report-query.dto';

export interface CommissionReportRow {
  employeeId: string;
  employeeName: string | null;
  invoicesCount: number;
  totalCommission: number;
}

export interface CommissionReport {
  period: { from: string; to: string };
  rows: CommissionReportRow[];
  total: number;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Employee sales-commission report — per-employee totals from the commission
 * lines of POSTED sales invoices within a date range. Read-only.
 */
@Injectable()
export class EmployeeCommissionReportService {
  constructor(
    @InjectRepository(SalesInvoiceCommission)
    private readonly commissionRepository: Repository<SalesInvoiceCommission>,
  ) {}

  async generate(query: CommissionReportQueryDto): Promise<CommissionReport> {
    const qb = this.commissionRepository
      .createQueryBuilder('c')
      .innerJoin('c.salesInvoice', 'si')
      .select('c.employeeId', 'employeeId')
      .addSelect('MAX(c.employeeName)', 'employeeName')
      .addSelect('COUNT(DISTINCT c.salesInvoiceId)', 'invoicesCount')
      .addSelect('COALESCE(SUM(c.amount), 0)', 'totalCommission')
      .where('si.status = :posted', { posted: SalesInvoiceStatus.POSTED })
      .andWhere('si.invoiceDate >= :from', { from: query.dateFrom })
      .andWhere('si.invoiceDate <= :to', { to: query.dateTo })
      .groupBy('c.employeeId')
      .orderBy('totalCommission', 'DESC');

    if (query.employeeId) qb.andWhere('c.employeeId = :eid', { eid: query.employeeId });

    const raw = await qb.getRawMany<{
      employeeId: string;
      employeeName: string | null;
      invoicesCount: string;
      totalCommission: string;
    }>();

    const rows: CommissionReportRow[] = raw.map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      invoicesCount: Number(r.invoicesCount),
      totalCommission: round2(Number(r.totalCommission)),
    }));
    const total = round2(rows.reduce((s, r) => s + r.totalCommission, 0));

    return { period: { from: query.dateFrom, to: query.dateTo }, rows, total };
  }
}
