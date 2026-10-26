import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { applyBranchScope, BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { SequenceService } from '../sequence/sequence.service';
import { JournalEntryService } from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';
import { JournalLineInput } from '../journal-entry/journal-entry.rules';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeCustody, EmployeeCustodySettlement } from './entities/employee-custody.entity';
import { CreateCustodyDto, CustodyQueryDto, HrReasonDto, SettleCustodyDto } from './dto/advance.dto';
import { CustodySettlementType, CustodyStatus, HrCashMethod, HrMovementStatus } from './enums/advance.enum';
import { HrPostingHelper } from './hr-posting.helper';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

/**
 * Employee custody (phase 3): draft → posted (DR employee custody [employee] /
 * CR treasury|bank) → settled by returned cash (DR cash / CR custody) and/or
 * expenses (DR expense accounts / CR custody). A custody is reversible only
 * while nothing was settled; each settlement is reversible on its own.
 */
@Injectable()
export class CustodyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sequences: SequenceService,
    private readonly journals: JournalEntryService,
    private readonly posting: HrPostingHelper,
  ) {}

  async list(q: CustodyQueryDto, scope: BranchScope): Promise<PaginatedResult<EmployeeCustody & { remaining: number }>> {
    const qb = this.dataSource.getRepository(EmployeeCustody).createQueryBuilder('c');
    this.filters(qb, q, scope);
    qb.orderBy('c.custodyDate', 'DESC').addOrderBy('c.createdAt', 'DESC').skip(q.skip).take(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items.map((c) => Object.assign(c, { remaining: this.remaining(c) })), total, q.page, q.perPage);
  }

  async summary(q: CustodyQueryDto, scope: BranchScope) {
    const qb = this.dataSource.getRepository(EmployeeCustody).createQueryBuilder('c');
    this.filters(qb, { ...q, status: undefined } as CustodyQueryDto, scope);
    const r = await qb
      .select('COUNT(*)', 'cnt')
      .addSelect(`SUM(CASE WHEN c.status IN ('open','partial') THEN 1 ELSE 0 END)`, 'open')
      .addSelect(`COALESCE(SUM(CASE WHEN c.status IN ('open','partial') THEN c.amount - c.settledAmount ELSE 0 END), 0)`, 'outstanding')
      .addSelect(`COUNT(DISTINCT CASE WHEN c.status IN ('open','partial') THEN c.employeeId END)`, 'employees')
      .addSelect(`SUM(CASE WHEN c.status = 'draft' THEN 1 ELSE 0 END)`, 'drafts')
      .getRawOne<Record<string, string>>();
    const n = (k: string) => Number(r?.[k] ?? 0) || 0;
    return { count: n('cnt'), open: n('open'), outstanding: round2(n('outstanding')), employees: n('employees'), drafts: n('drafts') };
  }

  private filters(qb: SelectQueryBuilder<EmployeeCustody>, q: CustodyQueryDto, scope: BranchScope): void {
    if (q.search) qb.andWhere('(c.custodyNumber LIKE :s OR c.employeeName LIKE :s OR c.purpose LIKE :s)', { s: `%${q.search}%` });
    if (q.status) qb.andWhere('c.status = :st', { st: q.status });
    if (q.employeeId) qb.andWhere('c.employeeId = :emp', { emp: q.employeeId });
    if (q.branchId) qb.andWhere('c.branchId = :br', { br: q.branchId });
    if (q.dateFrom) qb.andWhere('c.custodyDate >= :df', { df: q.dateFrom });
    if (q.dateTo) qb.andWhere('c.custodyDate <= :dt', { dt: q.dateTo });
    applyBranchScope(qb, 'c.branchId', scope);
  }

  async findOne(id: string, scope: BranchScope) {
    const c = await this.dataSource.getRepository(EmployeeCustody).findOne({
      where: { id },
      relations: { settlements: true },
      order: { settlements: { settlementDate: 'ASC', createdAt: 'ASC' } },
    });
    if (!c || !isWithinBranchScope(c.branchId, scope)) throw new NotFoundException('لم يتم العثور على العهدة');
    // expense account names for display
    const accIds = [...new Set(c.settlements.flatMap((s) => (s.expenseLines ?? []).map((l) => l.accountId)))];
    const accounts = accIds.length ? await this.dataSource.getRepository(ChartOfAccount).find({ where: { id: In(accIds) }, withDeleted: true }) : [];
    const accName = new Map(accounts.map((a) => [a.id, `${a.accountCode} - ${a.accountNameAr}`]));
    return {
      ...c,
      remaining: this.remaining(c),
      settlements: c.settlements.map((s) => ({ ...s, expenseLines: (s.expenseLines ?? []).map((l) => ({ ...l, accountName: accName.get(l.accountId) ?? l.accountId })) })),
    };
  }

  private remaining(c: EmployeeCustody): number {
    return c.status === CustodyStatus.DRAFT || c.status === CustodyStatus.REVERSED ? 0 : round2(c.amount - c.settledAmount);
  }

  // ── draft ──
  async create(dto: CreateCustodyDto, actorId: string | undefined, scope: BranchScope) {
    const employee = await this.activeEmployee(dto.employeeId, this.dataSource.manager);
    this.assertCashRef(dto.cash);
    const repo = this.dataSource.getRepository(EmployeeCustody);
    return repo.save(
      repo.create({
        employeeId: employee.id,
        employeeName: employee.name,
        branchId: this.resolveBranch(employee, scope),
        custodyDate: dto.custodyDate,
        amount: round2(dto.amount),
        purpose: dto.purpose?.trim() || null,
        status: CustodyStatus.DRAFT,
        paymentMethod: dto.cash.method,
        treasuryId: dto.cash.method === HrCashMethod.TREASURY ? dto.cash.treasuryId : null,
        bankAccountId: dto.cash.method === HrCashMethod.BANK ? dto.cash.bankAccountId : null,
        createdBy: actorId ?? null,
      }),
    );
  }

  async update(id: string, dto: CreateCustodyDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      if (c.status !== CustodyStatus.DRAFT) throw new BadRequestException('لا يمكن تعديل عهدة بعد صرفها');
      const employee = await this.activeEmployee(dto.employeeId, manager);
      this.assertCashRef(dto.cash);
      Object.assign(c, {
        employeeId: employee.id,
        employeeName: employee.name,
        branchId: c.employeeId === employee.id ? c.branchId : this.resolveBranch(employee, scope),
        custodyDate: dto.custodyDate,
        amount: round2(dto.amount),
        purpose: dto.purpose?.trim() || null,
        paymentMethod: dto.cash.method,
        treasuryId: dto.cash.method === HrCashMethod.TREASURY ? dto.cash.treasuryId : null,
        bankAccountId: dto.cash.method === HrCashMethod.BANK ? dto.cash.bankAccountId : null,
        updatedBy: actorId ?? null,
      });
      return manager.getRepository(EmployeeCustody).save(c);
    });
  }

  async remove(id: string, scope: BranchScope): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      if (c.status !== CustodyStatus.DRAFT) throw new BadRequestException('يمكن حذف العهدة وهي مسودة فقط — استخدم العكس');
      await manager.softDelete(EmployeeCustody, c.id);
    });
  }

  // ── post / reverse ──
  async post(id: string, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      if (c.status !== CustodyStatus.DRAFT) throw new BadRequestException('العهدة مُرحّلة بالفعل');
      const { custody } = await this.posting.accounts(manager);
      if (!custody) throw new BadRequestException('حساب عُهد الموظفين غير محدد في إعدادات المحاسبة');
      const ref = { method: c.paymentMethod, treasuryId: c.treasuryId, bankAccountId: c.bankAccountId };
      const { fiscalYear, period } = await this.posting.context(c.custodyDate, manager);
      const cash = await this.posting.cashLeg(ref, manager);
      const number = await this.sequences.nextDocumentNumber('CUS', fiscalYear, manager);
      const branchId = c.branchId ?? cash.branchId;
      const description = `صرف عهدة ${number} — ${c.employeeName ?? ''}${c.purpose ? ` — ${c.purpose}` : ''}`;
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.EMPLOYEE_CUSTODY,
          sourceId: c.id,
          sourceNumber: number,
          entryDate: c.custodyDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId,
          description,
          lines: [
            { accountId: custody, debit: c.amount, credit: 0, employeeId: c.employeeId, description: `عهدة ${c.employeeName ?? ''}` },
            { accountId: cash.accountId, debit: 0, credit: c.amount, description: `صرف من ${cash.label}` },
          ],
          actorId: actorId ?? null,
        },
        manager,
      );
      await this.posting.recordCash(ref, { date: c.custodyDate, moneyIn: false, amount: c.amount, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: number, journalEntryId: je.id, description, actorId }, manager);
      Object.assign(c, { custodyNumber: number, status: CustodyStatus.OPEN, branchId, journalEntryId: je.id, updatedBy: actorId ?? null });
      return manager.getRepository(EmployeeCustody).save(c);
    });
  }

  async reverse(id: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      if (c.status !== CustodyStatus.OPEN) {
        throw new BadRequestException(c.status === CustodyStatus.PARTIAL ? 'لا يمكن عكس عهدة عليها تسويات — اعكس التسويات أولاً' : 'يمكن عكس العهدة المفتوحة فقط');
      }
      const date = dto.date ?? today();
      const description = `عكس عهدة ${c.custodyNumber ?? ''} — ${c.employeeName ?? ''} — ${dto.reason}`;
      const rev = await this.posting.reverseEntry(c.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: c.custodyNumber, description, actorId }, manager);
      await this.posting.recordCash(
        { method: c.paymentMethod, treasuryId: c.treasuryId, bankAccountId: c.bankAccountId },
        { date, moneyIn: true, amount: c.amount, reversal: true, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: c.custodyNumber, journalEntryId: rev.id, description, actorId },
        manager,
      );
      Object.assign(c, { status: CustodyStatus.REVERSED, reversalJournalEntryId: rev.id, updatedBy: actorId ?? null });
      return manager.getRepository(EmployeeCustody).save(c);
    });
  }

  // ── settlements ──
  async settle(id: string, dto: SettleCustodyDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      if (c.status !== CustodyStatus.OPEN && c.status !== CustodyStatus.PARTIAL) throw new BadRequestException('يمكن تسوية عهدة مفتوحة فقط');
      if (dto.settlementDate < c.custodyDate) throw new BadRequestException('تاريخ التسوية لا يمكن أن يكون قبل تاريخ العهدة');
      const { custody } = await this.posting.accounts(manager);
      if (!custody) throw new BadRequestException('حساب عُهد الموظفين غير محدد في إعدادات المحاسبة');
      const remaining = round2(c.amount - c.settledAmount);
      const { fiscalYear, period } = await this.posting.context(dto.settlementDate, manager);

      const isCash = dto.settlementType === CustodySettlementType.CASH_RETURN;
      let amount: number;
      let debitLines: JournalLineInput[];
      let cashRef: { method: HrCashMethod; treasuryId?: string | null; bankAccountId?: string | null } | null = null;
      const ref = c.custodyNumber ?? '';
      if (isCash) {
        if (!dto.amount || !dto.cash) throw new BadRequestException('حدد المبلغ المُعاد والخزينة أو البنك');
        this.assertCashRef(dto.cash);
        amount = round2(dto.amount);
        cashRef = dto.cash;
        const cash = await this.posting.cashLeg(dto.cash, manager);
        debitLines = [{ accountId: cash.accountId, debit: amount, credit: 0, description: `رد نقدية من عهدة ${ref} إلى ${cash.label}` }];
      } else {
        if (!dto.expenseLines?.length) throw new BadRequestException('أضف بند مصروف واحد على الأقل');
        await this.assertExpenseAccounts(dto.expenseLines.map((l) => l.accountId), custody, manager);
        amount = round2(dto.expenseLines.reduce((s, l) => s + l.amount, 0));
        debitLines = dto.expenseLines.map((l) => ({
          accountId: l.accountId,
          debit: round2(l.amount),
          credit: 0,
          description: l.description?.trim() || `مصروف من عهدة ${ref} — ${c.employeeName ?? ''}`,
        }));
      }
      if (amount > remaining + 0.009) throw new BadRequestException(`مبلغ التسوية (${amount}) أكبر من المتبقي في العهدة (${remaining})`);

      const settlement = await manager.getRepository(EmployeeCustodySettlement).save(
        manager.getRepository(EmployeeCustodySettlement).create({
          custodyId: c.id,
          settlementDate: dto.settlementDate,
          settlementType: dto.settlementType,
          amount,
          method: cashRef?.method ?? null,
          treasuryId: cashRef?.method === HrCashMethod.TREASURY ? cashRef.treasuryId : null,
          bankAccountId: cashRef?.method === HrCashMethod.BANK ? cashRef.bankAccountId : null,
          expenseLines: isCash ? null : dto.expenseLines!.map((l) => ({ accountId: l.accountId, amount: round2(l.amount), description: l.description?.trim() || null })),
          notes: dto.notes?.trim() || null,
          createdBy: actorId ?? null,
        }),
      );
      const description = `${isCash ? 'رد نقدية من' : 'تسوية مصروفات'} عهدة ${ref} — ${c.employeeName ?? ''}`;
      const je = await this.journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.EMPLOYEE_CUSTODY,
          sourceId: c.id,
          sourceNumber: c.custodyNumber,
          entryDate: dto.settlementDate,
          fiscalYearId: fiscalYear.id,
          accountingPeriodId: period.id,
          branchId: c.branchId,
          description,
          lines: [...debitLines, { accountId: custody, debit: 0, credit: amount, employeeId: c.employeeId, description }],
          actorId: actorId ?? null,
        },
        manager,
      );
      if (cashRef) {
        await this.posting.recordCash(cashRef, { date: dto.settlementDate, moneyIn: true, amount, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: c.custodyNumber, journalEntryId: je.id, description, actorId }, manager);
      }
      settlement.journalEntryId = je.id;
      await manager.save(settlement);

      c.settledAmount = round2(c.settledAmount + amount);
      c.status = c.settledAmount + 0.009 >= c.amount ? CustodyStatus.SETTLED : CustodyStatus.PARTIAL;
      c.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeCustody).save(c);
    });
  }

  async reverseSettlement(id: string, settlementId: string, dto: HrReasonDto, actorId: string | undefined, scope: BranchScope) {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.lock(id, manager, scope);
      const s = await manager.findOne(EmployeeCustodySettlement, { where: { id: settlementId, custodyId: c.id } });
      if (!s) throw new NotFoundException('لم يتم العثور على التسوية');
      if (s.status !== HrMovementStatus.POSTED) throw new BadRequestException('التسوية معكوسة بالفعل');
      const date = dto.date ?? today();
      const description = `عكس تسوية عهدة ${c.custodyNumber ?? ''} — ${c.employeeName ?? ''} — ${dto.reason}`;
      const rev = await this.posting.reverseEntry(s.journalEntryId!, { date, reason: dto.reason, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: c.custodyNumber, description, actorId }, manager);
      if (s.settlementType === CustodySettlementType.CASH_RETURN && s.method) {
        await this.posting.recordCash(
          { method: s.method, treasuryId: s.treasuryId, bankAccountId: s.bankAccountId },
          { date, moneyIn: false, amount: s.amount, reversal: true, sourceType: JournalSourceType.EMPLOYEE_CUSTODY, sourceId: c.id, sourceNumber: c.custodyNumber, journalEntryId: rev.id, description, actorId },
          manager,
        );
      }
      s.status = HrMovementStatus.REVERSED;
      s.reversalJournalEntryId = rev.id;
      await manager.save(s);
      c.settledAmount = round2(Math.max(0, c.settledAmount - s.amount));
      c.status = c.settledAmount <= 0.009 ? CustodyStatus.OPEN : CustodyStatus.PARTIAL;
      c.updatedBy = actorId ?? null;
      return manager.getRepository(EmployeeCustody).save(c);
    });
  }

  // ── helpers ──
  private async assertExpenseAccounts(ids: string[], custodyAccount: string, manager: EntityManager): Promise<void> {
    const unique = [...new Set(ids)];
    const accounts = await manager.getRepository(ChartOfAccount).find({ where: { id: In(unique) } });
    if (accounts.length !== unique.length) throw new BadRequestException('أحد حسابات المصروفات غير موجود');
    for (const a of accounts) {
      if (!a.allowPosting || a.isHeader || !a.isActive) throw new BadRequestException(`الحساب «${a.accountNameAr}» لا يقبل الترحيل`);
      if (a.id === custodyAccount) throw new BadRequestException('لا يمكن تسوية العهدة على حساب العهد نفسه');
      if (a.requiresEmployee) throw new BadRequestException(`الحساب «${a.accountNameAr}» حساب موظفين — استخدم حساب مصروف`);
    }
  }

  private async lock(id: string, manager: EntityManager, scope: BranchScope): Promise<EmployeeCustody> {
    const c = await manager.findOne(EmployeeCustody, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!c || !isWithinBranchScope(c.branchId, scope)) throw new NotFoundException('لم يتم العثور على العهدة');
    return c;
  }

  private async activeEmployee(id: string, manager: EntityManager): Promise<Employee> {
    const e = await manager.findOne(Employee, { where: { id }, relations: { branches: true } });
    if (!e) throw new NotFoundException('لم يتم العثور على الموظف');
    if (!e.isActive) throw new BadRequestException('لا يمكن صرف عهدة لموظف ترك العمل');
    return e;
  }

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
