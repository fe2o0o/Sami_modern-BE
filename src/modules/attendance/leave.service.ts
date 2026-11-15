import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { BranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { LeaveType } from './entities/leave-type.entity';
import { EmployeeLeaveBalance } from './entities/employee-leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { AttendanceCalcService } from './attendance-calc.service';
import { AttendanceService } from './attendance.service';
import { AttendanceDayStatus, LeaveRequestStatus, RequestSource } from './attendance.enum';
import { cairoToday } from './attendance-time.util';
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecisionDto,
  LeaveBalancesQueryDto,
  LeaveRequestBodyDto,
  LeaveRequestsQueryDto,
  SetLeaveBalanceDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

export interface LeaveBalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  hasBalance: boolean;
  isPaid: boolean;
  year: number;
  /** null when the type has no balance. */
  entitledDays: number | null;
  usedDays: number;
  pendingDays: number;
  remainingDays: number | null;
  isCustom: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const NOT_WORKING = [AttendanceDayStatus.WEEKLY_OFF, AttendanceDayStatus.HOLIDAY, AttendanceDayStatus.NOT_EMPLOYED];

/** Leave (phase 5): types, yearly balances, requests and their approval. */
@Injectable()
export class LeaveService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calc: AttendanceCalcService,
    private readonly attendance: AttendanceService,
  ) {}

  // ── types ────────────────────────────────────────────
  listTypes(activeOnly = false) {
    return this.dataSource.getRepository(LeaveType).find({
      where: activeOnly ? { isActive: true } : {},
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createType(dto: CreateLeaveTypeDto) {
    const repo = this.dataSource.getRepository(LeaveType);
    return repo.save(
      repo.create({
        name: dto.name.trim(),
        nameEn: dto.nameEn?.trim() || null,
        defaultDaysPerYear: dto.defaultDaysPerYear ?? 0,
        hasBalance: dto.hasBalance ?? true,
        isPaid: dto.isPaid ?? true,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );
  }

  async updateType(id: string, dto: UpdateLeaveTypeDto) {
    const repo = this.dataSource.getRepository(LeaveType);
    const t = await repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('لم يتم العثور على نوع الإجازة');
    Object.assign(t, {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.nameEn !== undefined && { nameEn: dto.nameEn?.trim() || null }),
      ...(dto.defaultDaysPerYear !== undefined && { defaultDaysPerYear: dto.defaultDaysPerYear }),
      ...(dto.hasBalance !== undefined && { hasBalance: dto.hasBalance }),
      ...(dto.isPaid !== undefined && { isPaid: dto.isPaid }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    });
    return repo.save(t);
  }

  async removeType(id: string) {
    const used = await this.dataSource.getRepository(LeaveRequest).count({ where: { leaveTypeId: id } });
    if (used) throw new BadRequestException('نوع الإجازة عليه طلبات — أوقفه بدلاً من حذفه');
    const r = await this.dataSource.getRepository(LeaveType).softDelete(id);
    if (!r.affected) throw new NotFoundException('لم يتم العثور على نوع الإجازة');
    await this.dataSource.getRepository(EmployeeLeaveBalance).delete({ leaveTypeId: id });
    return { id };
  }

  // ── balances ─────────────────────────────────────────
  /** Balances of many employees for a year (one query per table). */
  async balancesFor(employeeIds: string[], year: number): Promise<Map<string, LeaveBalanceRow[]>> {
    const out = new Map<string, LeaveBalanceRow[]>();
    if (!employeeIds.length) return out;
    const [types, custom, requests] = await Promise.all([
      this.listTypes(true),
      this.dataSource.getRepository(EmployeeLeaveBalance).find({ where: { employeeId: In(employeeIds), year } }),
      this.dataSource
        .getRepository(LeaveRequest)
        .createQueryBuilder('l')
        .where('l.employeeId IN (:...ids)', { ids: employeeIds })
        .andWhere('l.status IN (:...st)', { st: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.PENDING] })
        .andWhere('YEAR(l.fromDate) = :y', { y: year })
        .getMany(),
    ]);
    for (const id of employeeIds) {
      out.set(
        id,
        types.map((t) => {
          const own = custom.find((c) => c.employeeId === id && c.leaveTypeId === t.id);
          const mine = requests.filter((r) => r.employeeId === id && r.leaveTypeId === t.id);
          const used = r1(mine.filter((r) => r.status === LeaveRequestStatus.APPROVED).reduce((a, r) => a + Number(r.days), 0));
          const pending = r1(mine.filter((r) => r.status === LeaveRequestStatus.PENDING).reduce((a, r) => a + Number(r.days), 0));
          const entitled = t.hasBalance ? Number(own ? own.entitledDays : t.defaultDaysPerYear) : null;
          return {
            leaveTypeId: t.id,
            leaveTypeName: t.name,
            hasBalance: t.hasBalance,
            isPaid: t.isPaid,
            year,
            entitledDays: entitled,
            usedDays: used,
            pendingDays: pending,
            remainingDays: entitled === null ? null : r1(entitled - used),
            isCustom: !!own,
          };
        }),
      );
    }
    return out;
  }

  async balancesReport(q: LeaveBalancesQueryDto, scope: BranchScope) {
    const year = q.year ?? Number(cairoToday().slice(0, 4));
    const qb = this.attendance.scopedEmployees(scope, q.branchId).andWhere('e.isActive = 1').orderBy('e.name', 'ASC');
    if (q.employeeId) qb.andWhere('e.id = :eid', { eid: q.employeeId });
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s)', { s: `%${q.search}%` });
    const emps = await qb.getMany();
    const map = await this.balancesFor(emps.map((e) => e.id), year);
    return {
      year,
      types: (await this.listTypes(true)).map((t) => ({ id: t.id, name: t.name, hasBalance: t.hasBalance })),
      rows: emps.map((e) => ({ employee: { id: e.id, code: e.code, name: e.name, jobTitle: e.jobTitle }, balances: map.get(e.id) ?? [] })),
    };
  }

  async setBalance(dto: SetLeaveBalanceDto, scope: BranchScope) {
    const emp = await this.attendance.scopedEmployees(scope).andWhere('e.id = :id', { id: dto.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على الموظف');
    const type = await this.dataSource.getRepository(LeaveType).findOne({ where: { id: dto.leaveTypeId } });
    if (!type) throw new NotFoundException('لم يتم العثور على نوع الإجازة');
    if (!type.hasBalance) throw new BadRequestException('هذا النوع بدون رصيد');
    const repo = this.dataSource.getRepository(EmployeeLeaveBalance);
    const cur = await repo.findOne({ where: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year } });
    if (cur) {
      cur.entitledDays = dto.entitledDays;
      cur.notes = dto.notes ?? cur.notes;
      await repo.save(cur);
    } else {
      await repo.save(repo.create({ employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year, entitledDays: dto.entitledDays, notes: dto.notes ?? null }));
    }
    return (await this.balancesFor([dto.employeeId], dto.year)).get(dto.employeeId)!.find((b) => b.leaveTypeId === dto.leaveTypeId);
  }

  // ── requests ─────────────────────────────────────────
  /** Working days between two dates for this employee (weekly days off + public holidays excluded). */
  async workingDays(emp: Employee, from: string, to: string): Promise<number> {
    const days = (await this.calc.computeDays([emp], from, to)).get(emp.id) ?? [];
    return days.filter((d) => !NOT_WORKING.includes(d.status)).length;
  }

  private async validate(emp: Employee, body: LeaveRequestBodyDto, excludeId?: string) {
    const from = body.fromDate.slice(0, 10);
    const to = body.toDate.slice(0, 10);
    if (to < from) throw new BadRequestException('تاريخ النهاية قبل البداية');
    if (from.slice(0, 4) !== to.slice(0, 4)) throw new BadRequestException('قسّم الإجازة: كل طلب داخل سنة واحدة');
    const type = await this.dataSource.getRepository(LeaveType).findOne({ where: { id: body.leaveTypeId } });
    if (!type || !type.isActive) throw new BadRequestException('نوع الإجازة غير متاح');

    const overlap = await this.dataSource
      .getRepository(LeaveRequest)
      .createQueryBuilder('l')
      .where('l.employeeId = :e', { e: emp.id })
      .andWhere('l.status IN (:...st)', { st: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] })
      .andWhere('l.fromDate <= :to AND l.toDate >= :from', { from, to })
      .andWhere(excludeId ? 'l.id <> :x' : '1 = 1', { x: excludeId })
      .getOne();
    if (overlap) throw new BadRequestException(`يوجد طلب إجازة آخر في نفس الفترة (${overlap.fromDate} → ${overlap.toDate})`);

    const days = await this.workingDays(emp, from, to);
    if (!days) throw new BadRequestException('الفترة كلها إجازات أسبوعية أو رسمية — لا توجد أيام عمل');
    const balance = (await this.balancesFor([emp.id], Number(from.slice(0, 4)))).get(emp.id)!.find((b) => b.leaveTypeId === type.id);
    return { from, to, type, days, balance };
  }

  /** Days + remaining balance before sending (the app shows it under the form). */
  async preview(emp: Employee, body: LeaveRequestBodyDto) {
    const v = await this.validate(emp, body);
    const free = v.balance?.remainingDays === null || v.balance?.remainingDays === undefined ? null : r1(v.balance.remainingDays - v.balance.pendingDays);
    return { days: v.days, remainingDays: v.balance?.remainingDays ?? null, availableDays: free, hasBalance: v.type.hasBalance, enough: free === null || free >= v.days };
  }

  async create(emp: Employee, body: LeaveRequestBodyDto, source: RequestSource, userId: string | null) {
    const v = await this.validate(emp, body);
    if (v.type.hasBalance && v.balance && v.balance.remainingDays !== null) {
      const free = r1(v.balance.remainingDays - v.balance.pendingDays);
      if (v.days > free) throw new BadRequestException(`الرصيد المتاح من «${v.type.name}» ${free} يوم والطلب ${v.days} يوم`);
    }
    const repo = this.dataSource.getRepository(LeaveRequest);
    return repo.save(
      repo.create({
        employeeId: emp.id,
        leaveTypeId: v.type.id,
        leaveTypeName: v.type.name,
        fromDate: v.from,
        toDate: v.to,
        days: v.days,
        reason: body.reason?.trim() || null,
        status: LeaveRequestStatus.PENDING,
        source,
        createdByUserId: userId,
      }),
    );
  }

  /** HR enters a leave for an employee (optionally approved at once). */
  async createByHr(dto: CreateLeaveRequestDto, user: AuthenticatedUser, scope: BranchScope) {
    const emp = await this.attendance.scopedEmployees(scope).andWhere('e.id = :id', { id: dto.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على الموظف');
    if (dto.approveNow && !user.isSuperAdmin && !user.permissions.includes('leaves.approve')) {
      throw new ForbiddenException('ليس لديك صلاحية لاعتماد الإجازات');
    }
    const req = await this.create(emp, dto, RequestSource.ERP, user.userId);
    return dto.approveNow ? this.decide(req.id, LeaveRequestStatus.APPROVED, { note: null }, user.userId, scope) : req;
  }

  async list(q: LeaveRequestsQueryDto, scope: BranchScope) {
    const qb = this.dataSource.getRepository(LeaveRequest).createQueryBuilder('l').innerJoin('l.employee', 'e').addSelect(['e.id', 'e.code', 'e.name', 'e.jobTitle']);
    this.scopeOn(qb, scope);
    if (q.branchId) {
      qb.andWhere(
        '(EXISTS (SELECT 1 FROM employee_branches eb3 WHERE eb3.employee_id = e.id AND eb3.branch_id = :fb) OR NOT EXISTS (SELECT 1 FROM employee_branches eb4 WHERE eb4.employee_id = e.id))',
        { fb: q.branchId },
      );
    }
    if (q.status) qb.andWhere('l.status = :st', { st: q.status });
    if (q.employeeId) qb.andWhere('l.employeeId = :emp', { emp: q.employeeId });
    if (q.leaveTypeId) qb.andWhere('l.leaveTypeId = :lt', { lt: q.leaveTypeId });
    if (q.from) qb.andWhere('l.toDate >= :from', { from: q.from.slice(0, 10) });
    if (q.to) qb.andWhere('l.fromDate <= :to', { to: q.to.slice(0, 10) });
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s)', { s: `%${q.search}%` });
    // Pending first, then newest.
    qb.addSelect(`CASE WHEN l.status = 'pending' THEN 0 ELSE 1 END`, 'status_rank')
      .orderBy('status_rank', 'ASC')
      .addOrderBy('l.fromDate', 'DESC')
      .offset(q.skip)
      .limit(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items.map((l) => this.row(l)), total, q.page, q.perPage);
  }

  pendingCount(scope: BranchScope) {
    const qb = this.dataSource.getRepository(LeaveRequest).createQueryBuilder('l').innerJoin('l.employee', 'e').where('l.status = :st', { st: LeaveRequestStatus.PENDING });
    this.scopeOn(qb, scope);
    return qb.getCount();
  }

  private scopeOn(qb: ReturnType<DataSource['createQueryBuilder']>, scope: BranchScope) {
    if (scope === null) return;
    if (!scope.length) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(
      '(EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id IN (:...sc)) OR NOT EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id))',
      { sc: scope },
    );
  }

  private row(l: LeaveRequest) {
    const { employee, ...rest } = l;
    return { ...rest, employeeCode: employee?.code, employeeName: employee?.name, jobTitle: employee?.jobTitle ?? null };
  }

  mine(employeeId: string) {
    return this.dataSource.getRepository(LeaveRequest).find({ where: { employeeId }, order: { fromDate: 'DESC' }, take: 100 });
  }

  /** Approve / reject a pending request, or cancel an approved one (HR). */
  async decide(id: string, to: LeaveRequestStatus, dto: DecisionDto, userId: string | undefined, scope: BranchScope) {
    const repo = this.dataSource.getRepository(LeaveRequest);
    const l = await repo.findOne({ where: { id } });
    if (!l) throw new NotFoundException('لم يتم العثور على طلب الإجازة');
    const emp = await this.attendance.scopedEmployees(scope).andWhere('e.id = :id', { id: l.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على طلب الإجازة');

    if (to === LeaveRequestStatus.CANCELLED) {
      if (![LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED].includes(l.status)) throw new BadRequestException('لا يمكن إلغاء هذا الطلب');
    } else if (l.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('الطلب تم البت فيه بالفعل');
    }

    if (to === LeaveRequestStatus.APPROVED) {
      // Re-check the balance at approval time (other leaves may have been approved meanwhile).
      const type = await this.dataSource.getRepository(LeaveType).findOne({ where: { id: l.leaveTypeId }, withDeleted: true });
      if (type?.hasBalance) {
        const b = (await this.balancesFor([l.employeeId], Number(l.fromDate.slice(0, 4)))).get(l.employeeId)!.find((x) => x.leaveTypeId === l.leaveTypeId);
        if (b && b.remainingDays !== null && Number(l.days) > b.remainingDays) {
          throw new BadRequestException(`الرصيد المتبقي من «${l.leaveTypeName}» ${b.remainingDays} يوم والطلب ${l.days} يوم — عدّل الرصيد أو ارفض الطلب`);
        }
      }
    }
    if (to === LeaveRequestStatus.REJECTED && !dto.note?.trim()) throw new BadRequestException('اكتب سبب الرفض');

    await repo.update(id, { status: to, decidedByUserId: userId ?? null, decidedAt: new Date(), decisionNote: dto.note?.trim() || null });
    return repo.findOne({ where: { id } });
  }

  /** The employee withdraws a request that is still pending. */
  async cancelMine(employeeId: string, id: string) {
    const repo = this.dataSource.getRepository(LeaveRequest);
    const l = await repo.findOne({ where: { id, employeeId } });
    if (!l) throw new NotFoundException('لم يتم العثور على طلب الإجازة');
    if (l.status !== LeaveRequestStatus.PENDING) throw new BadRequestException('يمكن سحب الطلب قبل البت فيه فقط');
    await repo.update(id, { status: LeaveRequestStatus.CANCELLED, decidedAt: new Date(), decisionNote: 'سحبه الموظف' });
    return repo.findOne({ where: { id } });
  }
}
