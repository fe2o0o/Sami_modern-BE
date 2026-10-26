import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { applyBranchScope, BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { SequenceService } from '../sequence/sequence.service';
import { JournalEntryService } from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeAdvance, EmployeeAdvanceInstallment, EmployeeAdvanceRepayment } from './entities/employee-advance.entity';
import { AdvanceQueryDto, CreateAdvanceDto, HrReasonDto, PayAdvanceDto, RepayAdvanceDto } from './dto/advance.dto';
import { AdvanceStatus, HrCashMethod, HrMovementStatus, InstallmentStatus } from './enums/advance.enum';
import { HrPostingHelper } from './hr-posting.helper';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};
/** First day of the month of an ISO date, shifted by `add` months. */
const monthStart = (iso: string, add = 0): string => {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + add, 1));
  return d.toISOString().slice(0, 10);
};

/**
 * Employee advances (phase 3): draft → approved (`advances.approve`) → paid
 * from a treasury/bank (DR employee advances [employee] / CR cash) → recovered
 * by repayments that fill the installments in order (payroll will deduct them
 * later). Cancel before payment; reverse a paid advance only while nothing was
 * repaid. Every posting is one transaction.
 */
@Injectable()
export class AdvanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequenceService,
    private readonly journals: JournalEntryService,
    private readonly posting: HrPostingHelper,
  ) {}

  // ── read ───────────────────────────────────────────────
  async list(q: AdvanceQueryDto, scope: BranchScope): Promise<PaginatedResult<EmployeeAdvance & { remaining: number }>> {
    const qb = this.dataSource.getRepository(EmployeeAdvance).createQueryBuilder('a');
    this.filters(qb, q, scope);
    qb.orderBy('a.requestDate', 'DESC').addOrderBy('a.createdAt', 'DESC').skip(q.skip).take(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items.map((a) => Object.assign(a, { remaining: this.remaining(a) })), total, q.page, q.perPage);
  }

  async summary(q: AdvanceQueryDto, scope: BranchScope) {
    const qb = this.dataSource.getRepository(EmployeeAdvance).createQueryBuilder('a');
    this.filters(qb, { ...q, status: undefined, state: undefined } as AdvanceQueryDto, scope);
    const r = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect(`SUM(CASE WHEN a.status IN ('draft','approved') THEN 1 ELSE 0 END)`, 'pending')
      .addSelect(`SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END)`, 'approved')
      .addSelect(`COALESCE(SUM(CASE WHEN a.status = 'paid' THEN a.amount - a.repaidAmount ELSE 0 END), 0)`, 'outstanding')
      .addSelect(`SUM(CASE WHEN a.status = 'paid' THEN 1 ELSE 0 END)`, 'open')
      .addSelect(`COUNT(DISTINCT CASE WHEN a.status = 'paid' THEN a.employeeId END)`, 'employees')
      .addSelect(`COALESCE(SUM(CASE WHEN a.status IN ('paid','settled') THEN a.amount ELSE 0 END), 0)`, 'paidTotal')
      .getRawOne<Record<string, string>>();
    const n = (k: string) => Number(r?.[k] ?? 0) || 0;
    return { count: n('cnt'), pending: n('pending'), approved: n('approved'), outstanding: round2(n('outstanding')), open: n('open'), employees: n('employees'), paidTotal: round2(n('paidTotal')) };
  }

  private filters(qb: SelectQueryBuilder<EmployeeAdvance>, q: AdvanceQueryDto, scope: BranchScope): void {
    if (q.search) qb.andWhere('(a.advanceNumber LIKE :s OR a.employeeName LIKE :s OR a.reason LIKE :s)', { s: `%${q.search}%` });
    if (q.status) qb.andWhere('a.status = :st', { st: q.status });
    if (q.state === 'open') qb.andWhere(`a.status = '${AdvanceStatus.PAID}'`);
    if (q.employeeId) qb.andWhere('a.employeeId = :emp', { emp: q.employeeId });
    if (q.branchId) qb.andWhere('a.branchId = :br', { br: q.branchId });
    if (q.dateFrom) qb.andWhere('a.requestDate >= :df', { df: q.dateFrom });
    if (q.dateTo) qb.andWhere('a.requestDate <= :dt', { dt: q.dateTo });
    applyBranchScope(qb, 'a.branchId', scope);
  }

  async findOne(id: string, scope: BranchScope) {
    const a = await this.dataSource.getRepository(EmployeeAdvance).findOne({
      where: { id },
      relations: { installments: true, repayments: true },
      order: { installments: { sequence: 'ASC' }, repayments: { repaymentDate: 'ASC', createdAt: 'ASC' } },
    });
    if (!a || !isWithinBranchScope(a.branchId, scope)) throw new NotFoundException('لم يتم العثور على السلفة');
    const context = await this.employeeContext(a.employeeId, a.id);
    return { ...a, remaining: this.remaining(a), employeeContext: context };
  }

  private remaining(a: EmployeeAdvance): number {
    return a.status === AdvanceStatus.PAID || a.status === AdvanceStatus.SETTLED ? round2(a.amount - a.repaidAmount) : 0;
  }

  /** What the request screen shows: net salary, other open advances, the configured ceiling. */
  async employeeContext(employeeId: string, excludeId?: string) {
    const employee = await this.dataSource.getRepository(Employee).findOne({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('لم يتم العثور على الموظف');
    const qb = this.dataSource
      .getRepository(EmployeeAdvance)
      .createQueryBuilder('a')
      .select('COUNT(*)', 'n')
      .addSelect(`COALESCE(SUM(CASE WHEN a.status = 'paid' THEN a.amount - a.repaidAmount ELSE a.amount END), 0)`, 'open')
      .where('a.employeeId = :e', { e: employeeId })
      .andWhere(`a.status IN ('draft','approved','paid')`);
    if (excludeId) qb.andWhere('a.id <> :x', { x: excludeId });
    const r = await qb.getRawOne<{ n: string; open: string }>();
    const { settings } = await this.posting.accounts(this.dataSource.manager);
    const multiple = settings.maxAdvanceSalaryMultiple ? Number(settings.maxAdvanceSalaryMultiple) : null;
    const net = Number(employee.netSalary) || 0;
    return {
      employeeName: employee.name,
      netSalary: net,
      openAdvancesCount: Number(r?.n ?? 0),
      openAdvancesAmount: round2(Number(r?.open ?? 0)),
      maxAdvance: multiple && net > 0 ? round2(net * multiple) : null,
      maxAdvanceSalaryMultiple: multiple,
    };
  }

  // ── draft ──────────────────────────────────────────────
  async create(dto: CreateAdvanceDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await this.activeEmployee(dto.employeeId, manager);
      const advance = manager.getRepository(EmployeeAdvance).create({
        employeeId: employee.id,
        employeeName: employee.name,
        branchId: this.resolveBranch(employee, scope),
        requestDate: dto.requestDate,
        amount: round2(dto.amount),
        installmentsCount: dto.installments?.length || dto.installmentsCount,
        firstDeductionMonth: monthStart(dto.installments?.[0]?.dueMonth ?? dto.firstDeductionMonth),
        reason: dto.reason?.trim() || null,
        status: AdvanceStatus.DRAFT,
        createdBy: actorId ?? null,
        installments: this.schedule(dto),
      });
      await this.checkCeiling(employee, advance.amount);
      const saved = await manager.getRepository(EmployeeAdvance).save(advance);
      return saved;
    });
  }

  async update(id: string, dto: CreateAdvanceDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.DRAFT && a.status !== AdvanceStatus.APPROVED) throw new BadRequestException('لا يمكن تعديل سلفة بعد صرفها');
      const employee = await this.activeEmployee(dto.employeeId, manager);
      await manager.delete(EmployeeAdvanceInstallment, { advanceId: a.id });
      Object.assign(a, {
        employeeId: employee.id,
        employeeName: employee.name,
        branchId: a.employeeId === employee.id ? a.branchId : this.resolveBranch(employee, scope),
        requestDate: dto.requestDate,
        amount: round2(dto.amount),
        installmentsCount: dto.installments?.length || dto.installmentsCount,
        firstDeductionMonth: monthStart(dto.installments?.[0]?.dueMonth ?? dto.firstDeductionMonth),
        reason: dto.reason?.trim() || null,
        // editing an approved advance sends it back for approval
        status: AdvanceStatus.DRAFT,
        approvedAt: null,
        approvedBy: null,
        updatedBy: actorId ?? null,
      });
      await this.checkCeiling(employee, a.amount, a.id);
      const saved = await manager.getRepository(EmployeeAdvance).save(a);
      await manager.getRepository(EmployeeAdvanceInstallment).save(this.schedule(dto).map((i) => ({ ...i, advanceId: saved.id })));
      return saved;
    });
  }

  /** Equal monthly installments (last one absorbs the rounding), or the custom schedule. */
  private schedule(dto: CreateAdvanceDto): EmployeeAdvanceInstallment[] {
    const amount = round2(dto.amount);
    const repo = this.dataSource.getRepository(EmployeeAdvanceInstallment);
    if (dto.installments?.length) {
      const total = round2(dto.installments.reduce((s, i) => s + i.amount, 0));
      if (Math.abs(total - amount) > 0.009) throw new BadRequestException(`مجموع الأقساط (${total}) لا يساوي مبلغ السلفة (${amount})`);
      const months = dto.installments.map((i) => monthStart(i.dueMonth));
      if (new Set(months).size !== months.length) throw new BadRequestException('يوجد أكثر من قسط في نفس الشهر');
      return [...dto.installments]
        .sort((x, y) => monthStart(x.dueMonth).localeCompare(monthStart(y.dueMonth)))
        .map((i, idx) => repo.create({ sequence: idx + 1, dueMonth: monthStart(i.dueMonth), amount: round2(i.amount), paidAmount: 0, status: InstallmentStatus.PENDING }));
    }
    const n = dto.installmentsCount;
    const each = Math.floor((amount / n) * 100) / 100;
    return Array.from({ length: n }, (_, idx) =>
      repo.create({
        sequence: idx + 1,
        dueMonth: monthStart(dto.firstDeductionMonth, idx),
        amount: idx === n - 1 ? round2(amount - each * (n - 1)) : each,
        paidAmount: 0,
        status: InstallmentStatus.PENDING,
      }),
    );
  }

  private async checkCeiling(employee: Employee, amount: number, excludeId?: string): Promise<void> {
    const ctx = await this.employeeContext(employee.id, excludeId);
    if (ctx.maxAdvance !== null && amount > ctx.maxAdvance + 0.009) {
      throw new BadRequestException(
        `مبلغ السلفة (${amount}) يتجاوز الحد الأقصى (${ctx.maxAdvance}) = ${ctx.maxAdvanceSalaryMultiple} × صافي الراتب`,
      );
    }
  }

  async remove(id: string, scope: BranchScope): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.DRAFT) throw new BadRequestException('يمكن حذف السلفة وهي مسودة فقط — استخدم الإلغاء أو العكس');
      await manager.softDelete(EmployeeAdvance, a.id);
    });
  }

  // ── workflow ───────────────────────────────────────────
  async approve(id: string, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.DRAFT) throw new BadRequestException('يمكن اعتماد السلفة وهي مسودة فقط');
      a.status = AdvanceStatus.APPROVED;
      a.approvedAt = new Date();
      a.approvedBy = actorId ?? null;
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  async cancel(id: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.DRAFT && a.status !== AdvanceStatus.APPROVED) throw new BadRequestException('لا يمكن إلغاء سلفة بعد صرفها — استخدم العكس');
      a.status = AdvanceStatus.CANCELLED;
      a.cancelReason = dto.reason.trim();
      a.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  /** Pay the approved advance: DR employee advances [employee] / CR treasury|bank. */
  async pay(id: string, dto: PayAdvanceDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.APPROVED) throw new BadRequestException('لا يمكن صرف سلفة غير معتمدة');
      const { advances } = await this.posting.accounts(manager);
      if (!advances) throw new BadRequestException('حساب سلف الموظفين غير محدد في إعدادات المحاسبة');
      this.assertCashRef(dto.cash);
      const { fiscalYear, period } = await this.posting.context(dto.paidDate, manager);
      const cash = await this.posting.cashLeg(dto.cash, manager);
      const number = await this.sequences.nextDocumentNumber('ADV', fiscalYear, manager);
      const branchId = a.branchId ?? cash.branchId;
      const description = `صرف سلفة ${number} — ${a.employeeName ?? ''}${a.reason ? ` — ${a.reason}` : ''}`;
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.EMPLOYEE_ADVANCE,
          sourceId: a.id,
          sourceNumber: number,
          entryDate: dto.paidDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId,
          description,
          lines: [
            { accountId: advances, debit: a.amount, credit: 0, employeeId: a.employeeId, description: `سلفة ${a.employeeName ?? ''} (${a.installmentsCount} قسط)` },
            { accountId: cash.accountId, debit: 0, credit: a.amount, description: `صرف من ${cash.label}` },
          ],
          actorId: actorId ?? null,
        },
        manager,
      );
      await this.posting.recordCash(dto.cash, { date: dto.paidDate, moneyIn: false, amount: a.amount, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: number, journalEntryId: je.id, description, actorId }, manager);
      Object.assign(a, {
        advanceNumber: number,
        status: AdvanceStatus.PAID,
        paidDate: dto.paidDate,
        paymentMethod: dto.cash.method,
        treasuryId: dto.cash.method === HrCashMethod.TREASURY ? dto.cash.treasuryId : null,
        bankAccountId: dto.cash.method === HrCashMethod.BANK ? dto.cash.bankAccountId : null,
        branchId,
        journalEntryId: je.id,
        updatedBy: actorId ?? null,
      });
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  /** Reverse a paid advance (only while nothing has been repaid). */
  async reverse(id: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.PAID) throw new BadRequestException('يمكن عكس السلفة المصروفة فقط');
      if (a.repaidAmount > 0.009) throw new BadRequestException('لا يمكن عكس سلفة تم سداد جزء منها — اعكس السدادات أولاً');
      const date = dto.date ?? today();
      const description = `عكس صرف سلفة ${a.advanceNumber ?? ''} — ${a.employeeName ?? ''} — ${dto.reason}`;
      const rev = await this.posting.reverseEntry(a.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: a.advanceNumber, description, actorId }, manager);
      await this.posting.recordCash(
        { method: a.paymentMethod!, treasuryId: a.treasuryId, bankAccountId: a.bankAccountId },
        { date, moneyIn: true, amount: a.amount, reversal: true, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: a.advanceNumber, journalEntryId: rev.id, description, actorId },
        manager,
      );
      a.status = AdvanceStatus.REVERSED;
      a.reversalJournalEntryId = rev.id;
      a.cancelReason = dto.reason.trim();
      a.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  /** Cash repayment: DR treasury|bank / CR employee advances [employee]; fills installments in order. */
  async repay(id: string, dto: RepayAdvanceDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      if (a.status !== AdvanceStatus.PAID) throw new BadRequestException('يمكن السداد على سلفة مصروفة لم تُسدَّد بالكامل فقط');
      const remaining = round2(a.amount - a.repaidAmount);
      const amount = round2(dto.amount);
      if (amount > remaining + 0.009) throw new BadRequestException(`مبلغ السداد (${amount}) أكبر من المتبقي على السلفة (${remaining})`);
      if (dto.repaymentDate < (a.paidDate ?? '')) throw new BadRequestException('تاريخ السداد لا يمكن أن يكون قبل تاريخ صرف السلفة');
      const { advances } = await this.posting.accounts(manager);
      if (!advances) throw new BadRequestException('حساب سلف الموظفين غير محدد في إعدادات المحاسبة');
      this.assertCashRef(dto.cash);
      const { fiscalYear, period } = await this.posting.context(dto.repaymentDate, manager);
      const cash = await this.posting.cashLeg(dto.cash, manager);

      // fill the oldest open installments first
      const installments = await manager.find(EmployeeAdvanceInstallment, { where: { advanceId: a.id }, order: { sequence: 'ASC' } });
      let left = amount;
      const allocation: { installmentId: string; amount: number }[] = [];
      for (const inst of installments) {
        if (left <= 0.009) break;
        const open = round2(inst.amount - inst.paidAmount);
        if (open <= 0.009) continue;
        const take = Math.min(open, left);
        inst.paidAmount = round2(inst.paidAmount + take);
        inst.status = inst.paidAmount + 0.009 >= inst.amount ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL;
        allocation.push({ installmentId: inst.id, amount: round2(take) });
        left = round2(left - take);
      }
      await manager.save(installments);

      const repayment = await manager.getRepository(EmployeeAdvanceRepayment).save(
        manager.getRepository(EmployeeAdvanceRepayment).create({
          advanceId: a.id,
          repaymentDate: dto.repaymentDate,
          amount,
          method: dto.cash.method,
          treasuryId: dto.cash.method === HrCashMethod.TREASURY ? dto.cash.treasuryId : null,
          bankAccountId: dto.cash.method === HrCashMethod.BANK ? dto.cash.bankAccountId : null,
          notes: dto.notes?.trim() || null,
          allocation,
          createdBy: actorId ?? null,
        }),
      );
      const description = `سداد سلفة ${a.advanceNumber ?? ''} — ${a.employeeName ?? ''}`;
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.EMPLOYEE_ADVANCE,
          sourceId: a.id,
          sourceNumber: a.advanceNumber,
          entryDate: dto.repaymentDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: a.branchId ?? cash.branchId,
          description,
          lines: [
            { accountId: cash.accountId, debit: amount, credit: 0, description: `تحصيل في ${cash.label}` },
            { accountId: advances, debit: 0, credit: amount, employeeId: a.employeeId, description },
          ],
          actorId: actorId ?? null,
        },
        manager,
      );
      await this.posting.recordCash(dto.cash, { date: dto.repaymentDate, moneyIn: true, amount, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: a.advanceNumber, journalEntryId: je.id, description, actorId }, manager);
      repayment.journalEntryId = je.id;
      await manager.save(repayment);

      a.repaidAmount = round2(a.repaidAmount + amount);
      if (a.repaidAmount + 0.009 >= a.amount) a.status = AdvanceStatus.SETTLED;
      a.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  /** Reverse one repayment: undo its installment allocation and its entry. */
  async reverseRepayment(id: string, repaymentId: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const a = await this.lock(id, manager, scope);
      const r = await manager.findOne(EmployeeAdvanceRepayment, { where: { id: repaymentId, advanceId: a.id } });
      if (!r) throw new NotFoundException('لم يتم العثور على السداد');
      if (r.status !== HrMovementStatus.POSTED) throw new BadRequestException('السداد معكوس بالفعل');
      const date = dto.date ?? today();
      const description = `عكس سداد سلفة ${a.advanceNumber ?? ''} — ${a.employeeName ?? ''} — ${dto.reason}`;
      const rev = await this.posting.reverseEntry(r.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: a.advanceNumber, description, actorId }, manager);
      await this.posting.recordCash(
        { method: r.method, treasuryId: r.treasuryId, bankAccountId: r.bankAccountId },
        { date, moneyIn: false, amount: r.amount, reversal: true, sourceType: JournalSourceType.EMPLOYEE_ADVANCE, sourceId: a.id, sourceNumber: a.advanceNumber, journalEntryId: rev.id, description, actorId },
        manager,
      );
      for (const al of r.allocation ?? []) {
        const inst = await manager.findOne(EmployeeAdvanceInstallment, { where: { id: al.installmentId } });
        if (!inst) continue;
        inst.paidAmount = round2(Math.max(0, inst.paidAmount - al.amount));
        inst.status = inst.paidAmount <= 0.009 ? InstallmentStatus.PENDING : inst.paidAmount + 0.009 >= inst.amount ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL;
        await manager.save(inst);
      }
      r.status = HrMovementStatus.REVERSED;
      r.reversalJournalEntryId = rev.id;
      await manager.save(r);
      a.repaidAmount = round2(Math.max(0, a.repaidAmount - r.amount));
      if (a.status === AdvanceStatus.SETTLED) a.status = AdvanceStatus.PAID;
      a.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeAdvance).save(a);
    });
  }

  // ── helpers ────────────────────────────────────────────
  private async lock(id: string, manager: EntityManager, scope: BranchScope): Promise<EmployeeAdvance> {
    const a = await manager.findOne(EmployeeAdvance, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!a || !isWithinBranchScope(a.branchId, scope)) throw new NotFoundException('لم يتم العثور على السلفة');
    return a;
  }

  private async activeEmployee(id: string, manager: EntityManager): Promise<Employee> {
    const e = await manager.findOne(Employee, { where: { id }, relations: { branches: true } });
    if (!e) throw new NotFoundException('لم يتم العثور على الموظف');
    if (!e.isActive) throw new BadRequestException('لا يمكن تسجيل سلفة لموظف ترك العمل');
    return e;
  }

  /** Employee's single branch; a restricted user's own branch when the employee serves several/all. */
  private resolveBranch(e: Employee, scope: BranchScope): string | null {
    const ids = (e.branches ?? []).map((b) => b.id);
    if (scope) {
      const inScope = ids.length ? ids.find((id) => scope.includes(id)) : scope[0];
      if (!inScope) throw new NotFoundException('لم يتم العثور على الموظف');
      return inScope;
    }
    return ids.length === 1 ? ids[0] : null;
  }

  private assertCashRef(c: { method: HrCashMethod; treasuryId?: string | null; bankAccountId?: string | null }): void {
    if (c.method === HrCashMethod.TREASURY && !c.treasuryId) throw new BadRequestException('اختر الخزينة');
    if (c.method === HrCashMethod.BANK && !c.bankAccountId) throw new BadRequestException('اختر الحساب البنكي');
  }
}
