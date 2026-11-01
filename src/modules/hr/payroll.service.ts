import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { Employee } from '../employee/entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { SequenceService } from '../sequence/sequence.service';
import { JournalEntryService } from '../journal-entry/journal-entry.service';
import { JournalLineInput } from '../journal-entry/journal-entry.rules';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { SalesReturnCommission } from '../sales-return/entities/sales-return-commission.entity';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { SalesReturnStatus } from '../sales-return/enums/sales-return.enum';
import { SalaryPackage } from './entities/salary-package.entity';
import { PayComponentType } from './enums/hr.enum';
import { EmployeeAdvance, EmployeeAdvanceInstallment, EmployeeAdvanceRepayment } from './entities/employee-advance.entity';
import { AdvanceStatus, HrCashMethod, HrMovementStatus, InstallmentStatus } from './enums/advance.enum';
import { PayrollLine, PayrollPayment, PayrollRun } from './entities/payroll-run.entity';
import {
  PayrollAdjustmentKind,
  PayrollAdvanceAllocation,
  PayrollLineComponent,
  PayrollStatus,
} from './enums/payroll.enum';
import { CreatePayrollRunDto, PayPayrollDto, PayrollQueryDto, UpdatePayrollLineDto } from './dto/payroll.dto';
import { HrReasonDto } from './dto/advance.dto';
import { HrPostingHelper } from './hr-posting.helper';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const pad = (n: number) => `${n}`.padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** 'YYYY-MM' (or any date in the month) → first / last day. */
const monthStart = (m: string) => `${m.slice(0, 7)}-01`;
const monthEnd = (m: string) => {
  const [y, mo] = m.slice(0, 7).split('-').map(Number);
  return `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`;
};
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (m: string) => `${MONTHS_AR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * Monthly payroll (مسير الرواتب) — Mini HR phase 6. One run per branch per month
 * for the employees whose «فرع صرف الراتب» is that branch:
 *   net = salary-package earnings + the month's sales commissions + bonuses
 *         − package deductions (taxes / insurance, entered manually) − penalties
 *         − advance installments due.
 * Approval (finance) posts ONE entry dated the month's last day:
 *   DR salaries expense (per component account) · DR commissions payable
 *   CR payroll deductions payable · CR employee advances (per employee) · CR salaries payable (per employee).
 * Payment (treasury or bank, all or some employees): DR salaries payable / CR cash.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequenceService,
    private readonly journals: JournalEntryService,
    private readonly posting: HrPostingHelper,
  ) {}

  // ── read ───────────────────────────────────────────────
  async list(q: PayrollQueryDto, scope: BranchScope): Promise<PaginatedResult<PayrollRun>> {
    const qb = this.dataSource.getRepository(PayrollRun).createQueryBuilder('r');
    applyBranchScope(qb, 'r.branchId', scope);
    if (q.branchId) qb.andWhere('r.branchId = :b', { b: q.branchId });
    if (q.status) qb.andWhere('r.status = :s', { s: q.status });
    if (q.year) qb.andWhere('YEAR(r.periodMonth) = :y', { y: Number(q.year) });
    qb.orderBy('r.periodMonth', 'DESC').addOrderBy('r.branchName', 'ASC').skip(q.skip).take(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, q.page, q.perPage);
  }

  async findOne(id: string, scope: BranchScope) {
    const run = await this.dataSource.getRepository(PayrollRun).findOne({
      where: { id },
      relations: { lines: true, payments: true },
      order: { lines: { employeeName: 'ASC' }, payments: { createdAt: 'ASC' } },
    });
    if (!run || !isWithinBranchScope(run.branchId, scope)) throw new NotFoundException('لم يتم العثور على المسير');
    // Draft: employees serving the branch whose pay branch is not set (they are in no run).
    const unassigned = run.status === PayrollStatus.DRAFT ? await this.unassignedEmployees(run.branchId) : [];
    return { ...run, monthLabel: monthLabel(run.periodMonth), unassigned };
  }

  /** Active employees serving `branchId` (or all branches) with no «فرع صرف الراتب». */
  async unassignedEmployees(branchId: string): Promise<{ id: string; code: string; name: string }[]> {
    return this.dataSource
      .getRepository(Employee)
      .createQueryBuilder('e')
      .select(['e.id AS id', 'e.code AS code', 'e.name AS name'])
      .where('e.payrollBranchId IS NULL')
      .andWhere('e.isActive = 1')
      .andWhere(
        new Brackets((w) =>
          w
            .where('EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = :b)', { b: branchId })
            .orWhere('NOT EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id)'),
        ),
      )
      .orderBy('e.name', 'ASC')
      .getRawMany();
  }

  // ── draft ──────────────────────────────────────────────
  async create(dto: CreatePayrollRunDto, actorId: string | undefined, scope: BranchScope) {
    if (!isWithinBranchScope(dto.branchId, scope)) throw new BadRequestException('الفرع خارج نطاق صلاحياتك');
    const id = await this.dataSource.transaction(async (manager) => {
      const branch = await manager.findOne(Branch, { where: { id: dto.branchId } });
      if (!branch) throw new NotFoundException('الفرع غير موجود');
      const period = monthStart(dto.month);
      const dup = await manager
        .getRepository(PayrollRun)
        .createQueryBuilder('r')
        .where('r.branchId = :b AND r.periodMonth = :m', { b: branch.id, m: period })
        .andWhere('r.status <> :rev', { rev: PayrollStatus.REVERSED })
        .getOne();
      if (dup) throw new ConflictException(`يوجد مسير لفرع «${branch.name}» عن ${monthLabel(period)} بالفعل${dup.runNumber ? ` (${dup.runNumber})` : ''}`);
      const run = await manager.getRepository(PayrollRun).save(
        manager.getRepository(PayrollRun).create({
          branchId: branch.id,
          branchName: branch.name,
          periodMonth: period,
          status: PayrollStatus.DRAFT,
          notes: dto.notes?.trim() || null,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        }),
      );
      await this.fill(run, manager);
      return run.id;
    });
    return this.findOne(id, scope);
  }

  /** Re-read everything (packages, commissions, installments, employees) — keeps manual bonuses / penalties / notes. */
  async recalculate(id: string, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockDraft(id, manager, scope);
      run.updatedBy = actorId ?? null;
      await this.fill(run, manager);
    });
    return this.findOne(id, scope);
  }

  async updateLine(id: string, lineId: string, dto: UpdatePayrollLineDto, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockDraft(id, manager, scope);
      const line = await manager.findOne(PayrollLine, { where: { id: lineId, runId: run.id } });
      if (!line) throw new NotFoundException('لم يتم العثور على سطر الموظف');
      if (dto.components) {
        const byId = new Map(dto.components.map((c) => [c.payComponentId, round2(c.amount)]));
        line.components = (line.components ?? []).map((c) => (byId.has(c.payComponentId) ? { ...c, amount: byId.get(c.payComponentId)! } : c));
      }
      if (dto.adjustments) {
        line.adjustments = dto.adjustments.map((a) => ({ kind: a.kind, amount: round2(a.amount), note: a.note?.trim() || null }));
      }
      if (dto.commissionOverride !== undefined) line.commissionOverride = dto.commissionOverride === null ? null : round2(dto.commissionOverride);
      if (dto.advanceOverride !== undefined) line.advanceOverride = dto.advanceOverride === null ? null : round2(dto.advanceOverride);
      if (dto.notes !== undefined) line.notes = dto.notes?.trim() || null;
      line.commissions = this.commissionOf(line);
      await this.recomputeLine(line, manager, run.periodMonth);
      await manager.save(line);
      run.updatedBy = actorId ?? null;
      await this.refreshTotals(run, manager);
    });
    return this.findOne(id, scope);
  }

  async removeLine(id: string, lineId: string, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockDraft(id, manager, scope);
      const line = await manager.findOne(PayrollLine, { where: { id: lineId, runId: run.id } });
      if (!line) throw new NotFoundException('لم يتم العثور على سطر الموظف');
      await manager.delete(PayrollLine, line.id);
      await this.refreshTotals(run, manager);
    });
    return this.findOne(id, scope);
  }

  async remove(id: string, scope: BranchScope): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockDraft(id, manager, scope);
      await manager.delete(PayrollLine, { runId: run.id });
      await manager.softDelete(PayrollRun, run.id);
    });
  }

  // ── approve & post ─────────────────────────────────────
  async approve(id: string, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lockDraft(id, manager, scope);
      const lines = await manager.find(PayrollLine, { where: { runId: run.id } });
      if (!lines.length) throw new BadRequestException('المسير لا يحتوي على موظفين');
      const negative = lines.find((l) => l.netPay < -0.009);
      if (negative) throw new BadRequestException(`صافي راتب «${negative.employeeName ?? ''}» بالسالب — راجع الخصومات`);

      const { settings } = await this.posting.accounts(manager);
      const date = monthEnd(run.periodMonth);
      const { fiscalYear, period } = await this.posting.context(date, manager);
      if (!settings.salariesExpenseAccountId) throw new BadRequestException('حساب مصروف الرواتب غير محدد في إعدادات المحاسبة');
      if (!settings.salariesPayableAccountId) throw new BadRequestException('حساب الرواتب المستحقة غير محدد في إعدادات المحاسبة');

      // Advance installments must still be open as calculated (an advance may have been repaid meanwhile).
      for (const line of lines) {
        for (const al of line.advanceAllocation ?? []) {
          const inst = await manager.findOne(EmployeeAdvanceInstallment, { where: { id: al.installmentId } });
          if (!inst || round2(inst.amount - inst.paidAmount) + 0.009 < al.amount) {
            throw new BadRequestException(`قسط سلفة «${line.employeeName ?? ''}» تغيّر بعد الحساب — اضغط «تحديث» ثم اعتمد`);
          }
        }
      }

      const label = `مسير رواتب ${run.branchName ?? ''} — ${monthLabel(run.periodMonth)}`;
      // signed per account: + debit / − credit (aggregated), employee-tagged lines separate
      const agg = new Map<string, { amount: number; description: string }>();
      const add = (accountId: string, amount: number, description: string) => {
        const cur = agg.get(accountId) ?? { amount: 0, description };
        cur.amount = round2(cur.amount + amount);
        agg.set(accountId, cur);
      };
      const perEmployee: JournalLineInput[] = [];
      let commissions = 0; // accrued (calculated) — clears the commissions payable
      let commissionDiff = 0; // manual amount − accrued — commission expense
      for (const l of lines) {
        for (const c of l.components ?? []) {
          if (!c.amount) continue;
          if (c.componentType === PayComponentType.EARNING) {
            add(c.accountId ?? settings.salariesExpenseAccountId, c.amount, `رواتب وبدلات — ${label}`);
          } else {
            const acc = c.accountId ?? settings.payrollDeductionsAccountId;
            if (!acc) throw new BadRequestException(`حساب استقطاعات الرواتب (ضرائب وتأمينات) غير محدد في إعدادات المحاسبة — مطلوب لبند «${c.name}»`);
            add(acc, -c.amount, `استقطاعات رواتب (${c.name}) — ${label}`);
          }
        }
        for (const a of l.adjustments ?? []) {
          add(settings.salariesExpenseAccountId, a.kind === PayrollAdjustmentKind.BONUS ? a.amount : -a.amount, `رواتب ومكافآت وجزاءات — ${label}`);
        }
        const accrued = this.accruedCommission(l);
        commissions = round2(commissions + accrued);
        commissionDiff = round2(commissionDiff + l.commissions - accrued);
        if (l.advances > 0) {
          const { advances } = await this.posting.accounts(manager);
          if (!advances) throw new BadRequestException('حساب سلف الموظفين غير محدد في إعدادات المحاسبة');
          perEmployee.push({ accountId: advances, debit: 0, credit: l.advances, employeeId: l.employeeId, description: `خصم أقساط سلف من الراتب — ${l.employeeName ?? ''} — ${label}` });
        }
        if (l.netPay > 0) {
          perEmployee.push({ accountId: settings.salariesPayableAccountId, debit: 0, credit: l.netPay, employeeId: l.employeeId, description: `صافي راتب مستحق — ${l.employeeName ?? ''} — ${label}` });
        }
      }
      if (Math.abs(commissions) >= 0.005) {
        if (!settings.commissionPayableAccountId) throw new BadRequestException('حساب العمولات المستحقة غير محدد في إعدادات المحاسبة');
        add(settings.commissionPayableAccountId, commissions, `عمولات مبيعات مصروفة مع الرواتب — ${label}`);
      }
      if (Math.abs(commissionDiff) >= 0.005) {
        if (!settings.commissionExpenseAccountId) throw new BadRequestException('حساب مصروف العمولات غير محدد في إعدادات المحاسبة — مطلوب لتعديل العمولة يدوياً');
        add(settings.commissionExpenseAccountId, commissionDiff, `فرق تعديل العمولات يدوياً — ${label}`);
      }
      const journalLines: JournalLineInput[] = [];
      for (const [accountId, v] of agg) {
        if (Math.abs(v.amount) < 0.005) continue;
        journalLines.push({ accountId, debit: v.amount > 0 ? v.amount : 0, credit: v.amount < 0 ? -v.amount : 0, description: v.description });
      }
      journalLines.push(...perEmployee);

      const number = await this.sequences.nextDocumentNumber('PR', fiscalYear, manager);
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PAYROLL,
          sourceId: run.id,
          sourceNumber: number,
          entryDate: date,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: run.branchId,
          description: `${label} (${number})`,
          lines: journalLines,
          actorId: actorId ?? null,
        },
        manager,
      );

      // Recover the advance installments (one repayment per advance, «خصم من المسير»).
      const byAdvance = new Map<string, { employeeName: string | null; items: PayrollAdvanceAllocation[] }>();
      for (const l of lines) {
        for (const al of l.advanceAllocation ?? []) {
          const g = byAdvance.get(al.advanceId) ?? { employeeName: l.employeeName, items: [] };
          g.items.push(al);
          byAdvance.set(al.advanceId, g);
        }
      }
      for (const [advanceId, g] of byAdvance) {
        const advance = await manager.findOne(EmployeeAdvance, { where: { id: advanceId }, lock: { mode: 'pessimistic_write' } });
        if (!advance) continue;
        let total = 0;
        for (const al of g.items) {
          const inst = await manager.findOne(EmployeeAdvanceInstallment, { where: { id: al.installmentId } });
          if (!inst) continue;
          inst.paidAmount = round2(inst.paidAmount + al.amount);
          inst.status = inst.paidAmount + 0.009 >= inst.amount ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL;
          await manager.save(inst);
          total = round2(total + al.amount);
        }
        await manager.getRepository(EmployeeAdvanceRepayment).save(
          manager.getRepository(EmployeeAdvanceRepayment).create({
            advanceId,
            repaymentDate: date,
            amount: total,
            method: 'payroll',
            payrollRunId: run.id,
            treasuryId: null,
            bankAccountId: null,
            journalEntryId: je.id,
            notes: `خصم من مسير ${number}`,
            allocation: g.items.map((i) => ({ installmentId: i.installmentId, amount: i.amount })),
            createdBy: actorId ?? null,
          }),
        );
        advance.repaidAmount = round2(advance.repaidAmount + total);
        if (advance.repaidAmount + 0.009 >= advance.amount) advance.status = AdvanceStatus.SETTLED;
        advance.updatedBy = actorId ?? null;
        await manager.save(advance);
      }

      run.runNumber = number;
      run.status = PayrollStatus.APPROVED;
      run.journalEntryId = je.id;
      run.approvedBy = actorId ?? null;
      run.approvedAt = new Date();
      run.updatedBy = actorId ?? null;
      await manager.save(run);
    });
    return this.findOne(id, scope);
  }

  /** Undo the posting (before any salary is paid): reversal entry + the advance installments recovered. */
  async reverse(id: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lock(id, manager, scope);
      if (run.status !== PayrollStatus.APPROVED) {
        throw new BadRequestException(run.status === PayrollStatus.DRAFT ? 'المسير لم يُعتمد بعد' : 'لا يمكن عكس مسير صُرف منه رواتب — اعكس عمليات الصرف أولاً');
      }
      const date = dto.date ?? today();
      const label = `عكس مسير رواتب ${run.runNumber ?? ''} — ${dto.reason}`;
      await this.posting.reverseEntry(run.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.PAYROLL, sourceId: run.id, sourceNumber: run.runNumber, description: label, actorId }, manager);

      const repayments = await manager.find(EmployeeAdvanceRepayment, { where: { payrollRunId: run.id, status: HrMovementStatus.POSTED } });
      for (const r of repayments) {
        for (const al of r.allocation ?? []) {
          const inst = await manager.findOne(EmployeeAdvanceInstallment, { where: { id: al.installmentId } });
          if (!inst) continue;
          inst.paidAmount = round2(Math.max(0, inst.paidAmount - al.amount));
          inst.status = inst.paidAmount <= 0.009 ? InstallmentStatus.PENDING : inst.paidAmount + 0.009 >= inst.amount ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL;
          await manager.save(inst);
        }
        const advance = await manager.findOne(EmployeeAdvance, { where: { id: r.advanceId } });
        if (advance) {
          advance.repaidAmount = round2(Math.max(0, advance.repaidAmount - r.amount));
          if (advance.status === AdvanceStatus.SETTLED) advance.status = AdvanceStatus.PAID;
          advance.updatedBy = actorId ?? null;
          await manager.save(advance);
        }
        r.status = HrMovementStatus.REVERSED;
        await manager.save(r);
      }
      run.status = PayrollStatus.REVERSED;
      run.reversalReason = dto.reason;
      run.updatedBy = actorId ?? null;
      await manager.save(run);
    });
    return this.findOne(id, scope);
  }

  // ── pay ────────────────────────────────────────────────
  async pay(id: string, dto: PayPayrollDto, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lock(id, manager, scope);
      if (run.status !== PayrollStatus.APPROVED && run.status !== PayrollStatus.PARTIALLY_PAID) {
        throw new BadRequestException('الصرف متاح لمسير معتمد لم يُصرف بالكامل فقط');
      }
      if (dto.paymentDate < monthStart(run.periodMonth)) throw new BadRequestException('تاريخ الصرف لا يمكن أن يكون قبل شهر المسير');
      if (dto.cash.method === HrCashMethod.TREASURY ? !dto.cash.treasuryId : !dto.cash.bankAccountId) {
        throw new BadRequestException(dto.cash.method === HrCashMethod.TREASURY ? 'اختر الخزينة' : 'اختر الحساب البنكي');
      }
      const { settings } = await this.posting.accounts(manager);
      if (!settings.salariesPayableAccountId) throw new BadRequestException('حساب الرواتب المستحقة غير محدد في إعدادات المحاسبة');
      const all = await manager.find(PayrollLine, { where: { runId: run.id } });
      const wanted = dto.lineIds?.length ? new Set(dto.lineIds) : null;
      const toPay = all
        .filter((l) => (!wanted || wanted.has(l.id)) && round2(l.netPay - l.paidAmount) > 0.009)
        .map((l) => ({ line: l, amount: round2(l.netPay - l.paidAmount) }));
      if (wanted && toPay.length !== wanted.size) throw new BadRequestException('أحد الموظفين المختارين صُرف راتبه بالفعل أو لا يتبع هذا المسير');
      if (!toPay.length) throw new BadRequestException('لا توجد رواتب متبقية للصرف');
      const amount = round2(toPay.reduce((s, x) => s + x.amount, 0));

      const { fiscalYear, period } = await this.posting.context(dto.paymentDate, manager);
      const cash = await this.posting.cashLeg(dto.cash, manager);
      const description = `صرف رواتب ${monthLabel(run.periodMonth)} — مسير ${run.runNumber ?? ''} — ${run.branchName ?? ''} (${toPay.length} موظف)`;
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.PAYROLL,
          sourceId: run.id,
          sourceNumber: run.runNumber,
          entryDate: dto.paymentDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: run.branchId,
          description,
          lines: [
            ...toPay.map((x) => ({ accountId: settings.salariesPayableAccountId!, debit: x.amount, credit: 0, employeeId: x.line.employeeId, description: `صرف راتب ${x.line.employeeName ?? ''}` })),
            { accountId: cash.accountId, debit: 0, credit: amount, description: `صرف رواتب من ${cash.label}` },
          ],
          actorId: actorId ?? null,
        },
        manager,
      );
      await this.posting.recordCash(dto.cash, { date: dto.paymentDate, moneyIn: false, amount, sourceType: JournalSourceType.PAYROLL, sourceId: run.id, sourceNumber: run.runNumber, journalEntryId: je.id, description, actorId }, manager);
      await manager.getRepository(PayrollPayment).save(
        manager.getRepository(PayrollPayment).create({
          runId: run.id,
          paymentDate: dto.paymentDate,
          method: dto.cash.method,
          treasuryId: dto.cash.method === HrCashMethod.TREASURY ? dto.cash.treasuryId : null,
          bankAccountId: dto.cash.method === HrCashMethod.BANK ? dto.cash.bankAccountId : null,
          amount,
          lines: toPay.map((x) => ({ lineId: x.line.id, employeeId: x.line.employeeId, amount: x.amount })),
          journalEntryId: je.id,
          notes: dto.notes?.trim() || null,
          createdBy: actorId ?? null,
        }),
      );
      for (const x of toPay) x.line.paidAmount = round2(x.line.paidAmount + x.amount);
      await manager.save(toPay.map((x) => x.line));
      run.paidAmount = round2(run.paidAmount + amount);
      run.status = run.paidAmount + 0.009 >= run.totalNet ? PayrollStatus.PAID : PayrollStatus.PARTIALLY_PAID;
      run.updatedBy = actorId ?? null;
      await manager.save(run);
    });
    return this.findOne(id, scope);
  }

  async reversePayment(id: string, paymentId: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    await this.dataSource.transaction(async (manager) => {
      const run = await this.lock(id, manager, scope);
      const p = await manager.findOne(PayrollPayment, { where: { id: paymentId, runId: run.id } });
      if (!p) throw new NotFoundException('لم يتم العثور على عملية الصرف');
      if (p.status !== HrMovementStatus.POSTED) throw new BadRequestException('عملية الصرف معكوسة بالفعل');
      const date = dto.date ?? today();
      const description = `عكس صرف رواتب — مسير ${run.runNumber ?? ''} — ${dto.reason}`;
      const rev = await this.posting.reverseEntry(p.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.PAYROLL, sourceId: run.id, sourceNumber: run.runNumber, description, actorId }, manager);
      await this.posting.recordCash(
        { method: p.method, treasuryId: p.treasuryId, bankAccountId: p.bankAccountId },
        { date, moneyIn: true, amount: p.amount, reversal: true, sourceType: JournalSourceType.PAYROLL, sourceId: run.id, sourceNumber: run.runNumber, journalEntryId: rev.id, description, actorId },
        manager,
      );
      const lines = await manager.find(PayrollLine, { where: { id: In(p.lines.map((x) => x.lineId)) } });
      const back = new Map(p.lines.map((x) => [x.lineId, x.amount]));
      for (const l of lines) l.paidAmount = round2(Math.max(0, l.paidAmount - (back.get(l.id) ?? 0)));
      await manager.save(lines);
      p.status = HrMovementStatus.REVERSED;
      p.reversalJournalEntryId = rev.id;
      await manager.save(p);
      run.paidAmount = round2(Math.max(0, run.paidAmount - p.amount));
      run.status = run.paidAmount <= 0.009 ? PayrollStatus.APPROVED : PayrollStatus.PARTIALLY_PAID;
      run.updatedBy = actorId ?? null;
      await manager.save(run);
    });
    return this.findOne(id, scope);
  }

  // ── calculation ────────────────────────────────────────
  /** (Re)build every line of a draft run from the current data. Manual bonuses / penalties / notes are kept. */
  private async fill(run: PayrollRun, manager: EntityManager): Promise<void> {
    const start = monthStart(run.periodMonth);
    const end = monthEnd(run.periodMonth);
    const employees = await manager
      .getRepository(Employee)
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.department', 'd')
      .where('e.payrollBranchId = :b', { b: run.branchId })
      .andWhere('(e.hireDate IS NULL OR e.hireDate <= :end)', { end })
      .andWhere('(e.exitDate IS NULL OR e.exitDate >= :start)', { start })
      .andWhere(new Brackets((w) => w.where('e.isActive = 1').orWhere('e.exitDate >= :start', { start })))
      .orderBy('e.name', 'ASC')
      .getMany();

    const old = await manager.find(PayrollLine, { where: { runId: run.id } });
    const kept = new Map(old.map((l) => [l.employeeId, l]));
    if (old.length) await manager.delete(PayrollLine, { runId: run.id });

    const lines: PayrollLine[] = [];
    for (const e of employees) {
      const prev = kept.get(e.id);
      const pkg = await manager
        .getRepository(SalaryPackage)
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.lines', 'pl')
        .leftJoinAndSelect('pl.payComponent', 'pc')
        .where('p.employeeId = :e AND p.effectiveFrom <= :end', { e: e.id, end })
        .orderBy('p.effectiveFrom', 'DESC')
        .getOne();
      const components: PayrollLineComponent[] = (pkg?.lines ?? [])
        .filter((pl) => pl.payComponent)
        .sort((a, b) => (a.payComponent.sortOrder ?? 0) - (b.payComponent.sortOrder ?? 0))
        .map((pl) => ({
          payComponentId: pl.payComponentId,
          code: pl.payComponent.code,
          name: pl.payComponent.name,
          componentType: pl.payComponent.componentType,
          isBasic: !!pl.payComponent.isBasic,
          accountId: pl.payComponent.accountId ?? null,
          amount: round2(Number(pl.amount) || 0),
        }));
      const line = manager.getRepository(PayrollLine).create({
        runId: run.id,
        employeeId: e.id,
        employeeCode: e.code,
        employeeName: e.name,
        jobTitle: e.jobTitle ?? null,
        departmentName: e.department?.name ?? null,
        salaryPackageId: pkg?.id ?? null,
        components,
        adjustments: prev?.adjustments ?? [],
        commissionOverride: prev?.commissionOverride ?? null,
        advanceOverride: prev?.advanceOverride ?? null,
        notes: prev?.notes ?? null,
        bankName: e.bankName ?? null,
        bankAccountNumber: e.bankAccountNumber ?? null,
        iban: e.iban ?? null,
        paidAmount: 0,
      });
      line.commissionDetail = await this.commissionsOf(e.id, start, end, manager);
      line.commissions = this.commissionOf(line);
      await this.recomputeLine(line, manager, run.periodMonth);
      lines.push(line);
    }
    if (lines.length) await manager.save(lines);
    await this.refreshTotals(run, manager);
  }

  /** Calculated commission of the month (invoices − returns), before any manual amount. */
  private accruedCommission(line: PayrollLine): number {
    const d = line.commissionDetail;
    return d ? round2(d.earned - d.returned) : 0;
  }
  /** The commission paid on the line: the manual amount when set, else the calculated one. */
  private commissionOf(line: PayrollLine): number {
    return line.commissionOverride !== null && line.commissionOverride !== undefined ? round2(line.commissionOverride) : this.accruedCommission(line);
  }

  /** Commissions of the month: posted invoices dated in it − taken back by returns posted in it. */
  private async commissionsOf(employeeId: string, start: string, end: string, manager: EntityManager) {
    const earned = await manager
      .getRepository(SalesInvoiceCommission)
      .createQueryBuilder('c')
      .innerJoin(SalesInvoice, 'si', 'si.id = c.salesInvoiceId AND si.deletedAt IS NULL')
      .select('COUNT(DISTINCT c.salesInvoiceId)', 'n')
      .addSelect('COALESCE(SUM(c.amount), 0)', 'amount')
      .where('c.employeeId = :e', { e: employeeId })
      .andWhere('si.status = :st', { st: SalesInvoiceStatus.POSTED })
      .andWhere('si.invoiceDate BETWEEN :start AND :end', { start, end })
      .getRawOne<{ n: string; amount: string }>();
    const returned = await manager
      .getRepository(SalesReturnCommission)
      .createQueryBuilder('rc')
      .innerJoin(SalesReturn, 'sr', 'sr.id = rc.salesReturnId AND sr.deletedAt IS NULL')
      .select('COALESCE(SUM(rc.amount), 0)', 'amount')
      .where('rc.employeeId = :e', { e: employeeId })
      .andWhere('sr.status = :st', { st: SalesReturnStatus.POSTED })
      .andWhere('sr.returnDate BETWEEN :start AND :end', { start, end })
      .getRawOne<{ amount: string }>();
    return { invoices: Number(earned?.n ?? 0), earned: round2(Number(earned?.amount ?? 0)), returned: round2(Number(returned?.amount ?? 0)) };
  }

  /**
   * Totals of one line. Advance installments due up to the month (oldest first) are
   * recovered only as far as the pay allows — the net never goes below zero —
   * and never more than a manual installment amount when one is set.
   */
  private async recomputeLine(line: PayrollLine, manager: EntityManager, periodMonth: string): Promise<void> {
    const comps = line.components ?? [];
    line.basicSalary = round2(comps.filter((c) => c.isBasic).reduce((s, c) => s + c.amount, 0));
    line.earnings = round2(comps.filter((c) => c.componentType === PayComponentType.EARNING).reduce((s, c) => s + c.amount, 0));
    const compDeductions = round2(comps.filter((c) => c.componentType !== PayComponentType.EARNING).reduce((s, c) => s + c.amount, 0));
    line.bonuses = round2((line.adjustments ?? []).filter((a) => a.kind === PayrollAdjustmentKind.BONUS).reduce((s, a) => s + a.amount, 0));
    const penalties = round2((line.adjustments ?? []).filter((a) => a.kind === PayrollAdjustmentKind.PENALTY).reduce((s, a) => s + a.amount, 0));
    line.deductions = round2(compDeductions + penalties);
    const available = round2(line.earnings + line.commissions + line.bonuses - line.deductions);

    // Re-plan the advance recovery whenever the pay changes (always against the open installments).
    const due = await manager
      .getRepository(EmployeeAdvanceInstallment)
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.advance', 'a')
      .where('a.employeeId = :e', { e: line.employeeId })
      .andWhere('a.status = :paid', { paid: AdvanceStatus.PAID })
      .andWhere('i.dueMonth <= :m', { m: monthEnd(periodMonth) })
      .andWhere('i.paidAmount < i.amount')
      .orderBy('i.dueMonth', 'ASC')
      .addOrderBy('i.sequence', 'ASC')
      .getMany();
    line.advanceDue = round2(due.reduce((s, i) => s + (i.amount - i.paidAmount), 0));
    let room = Math.max(0, available);
    if (line.advanceOverride !== null && line.advanceOverride !== undefined) room = Math.min(room, Math.max(0, line.advanceOverride));
    const allocation: PayrollAdvanceAllocation[] = [];
    for (const inst of due) {
      if (room <= 0.009) break;
      const open = round2(inst.amount - inst.paidAmount);
      const take = round2(Math.min(open, room));
      if (take <= 0) continue;
      allocation.push({ advanceId: inst.advanceId, advanceNumber: inst.advance?.advanceNumber ?? null, installmentId: inst.id, dueMonth: inst.dueMonth, amount: take });
      room = round2(room - take);
    }
    line.advanceAllocation = allocation;
    line.advances = round2(allocation.reduce((s, a) => s + a.amount, 0));
    line.netPay = round2(available - line.advances);
  }

  private async refreshTotals(run: PayrollRun, manager: EntityManager): Promise<void> {
    const lines = await manager.find(PayrollLine, { where: { runId: run.id } });
    const sum = (f: (l: PayrollLine) => number) => round2(lines.reduce((s, l) => s + f(l), 0));
    run.employeesCount = lines.length;
    run.totalEarnings = sum((l) => l.earnings);
    run.totalCommissions = sum((l) => l.commissions);
    run.totalBonuses = sum((l) => l.bonuses);
    run.totalDeductions = sum((l) => l.deductions);
    run.totalAdvances = sum((l) => l.advances);
    run.totalNet = sum((l) => l.netPay);
    await manager.save(run);
  }

  private async lock(id: string, manager: EntityManager, scope: BranchScope): Promise<PayrollRun> {
    const run = await manager.findOne(PayrollRun, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!run || !isWithinBranchScope(run.branchId, scope)) throw new NotFoundException('لم يتم العثور على المسير');
    return run;
  }

  private async lockDraft(id: string, manager: EntityManager, scope: BranchScope): Promise<PayrollRun> {
    const run = await this.lock(id, manager, scope);
    if (run.status !== PayrollStatus.DRAFT) throw new BadRequestException('المسير معتمد — لا يمكن تعديله (اعكسه أولاً)');
    return run;
  }
}
