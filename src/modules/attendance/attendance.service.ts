import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, IsNull, SelectQueryBuilder } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Employee } from '../employee/entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { AttendanceShift } from './entities/attendance-shift.entity';
import { AttendanceHoliday } from './entities/attendance-holiday.entity';
import { AttendancePunch } from './entities/attendance-punch.entity';
import { AttendanceCalcService, AttendanceDay } from './attendance-calc.service';
import { AttendanceDayStatus, PunchSource, PunchStatus, appFeaturesOf } from './attendance.enum';
import { addDays, cairoParts, cairoToUtc, cairoToday, monthRange } from './attendance-time.util';
import { normalizeMobile, nowSeconds } from './employee-app-auth.service';
import { maxAccuracyM } from './attendance-punch.service';
import {
  AttendanceEmployeesQueryDto,
  BranchLocationDto,
  CreateHolidayDto,
  CreateShiftDto,
  DailyBoardQueryDto,
  EmployeeAttendanceSetupDto,
  HolidayQueryDto,
  ManualPunchDto,
  MonthlyQueryDto,
  PunchQueryDto,
  UpdateShiftDto,
  VoidPunchDto,
} from './dto/attendance.dto';

type EmpRow = Pick<Employee, 'id' | 'code' | 'name' | 'jobTitle' | 'mobile' | 'shiftId' | 'hireDate' | 'exitDate' | 'attendanceEnabled' | 'isActive'> & {
  branchIds: string[];
  branchNames: string[];
};

/** HR side of attendance: shifts, holidays, branch locations, employee setup, punches log, corrections, reports. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calc: AttendanceCalcService,
  ) {}

  // ── shifts ───────────────────────────────────────────
  listShifts() {
    return this.dataSource.getRepository(AttendanceShift).find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  async createShift(dto: CreateShiftDto) {
    this.assertShiftTimes(dto.startTime, dto.endTime);
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(AttendanceShift);
      const anyDefault = await repo.count({ where: { isDefault: true } });
      const isDefault = dto.isDefault ?? !anyDefault; // the first shift becomes the default
      if (isDefault) await repo.update({ isDefault: true }, { isDefault: false });
      return repo.save(
        repo.create({
          name: dto.name.trim(),
          startTime: dto.startTime,
          endTime: dto.endTime,
          lateGraceMinutes: dto.lateGraceMinutes ?? 15,
          earlyLeaveGraceMinutes: dto.earlyLeaveGraceMinutes ?? 0,
          overtimeAfterMinutes: dto.overtimeAfterMinutes ?? 30,
          weeklyOffDays: [...new Set(dto.weeklyOffDays ?? [5])].sort(),
          isDefault,
          isActive: dto.isActive ?? true,
          notes: dto.notes ?? null,
        }),
      );
    });
  }

  async updateShift(id: string, dto: UpdateShiftDto) {
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(AttendanceShift);
      const s = await repo.findOne({ where: { id } });
      if (!s) throw new NotFoundException('لم يتم العثور على الوردية');
      this.assertShiftTimes(dto.startTime ?? s.startTime, dto.endTime ?? s.endTime);
      if (dto.isDefault) await repo.update({ isDefault: true }, { isDefault: false });
      Object.assign(s, {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.lateGraceMinutes !== undefined && { lateGraceMinutes: dto.lateGraceMinutes }),
        ...(dto.earlyLeaveGraceMinutes !== undefined && { earlyLeaveGraceMinutes: dto.earlyLeaveGraceMinutes }),
        ...(dto.overtimeAfterMinutes !== undefined && { overtimeAfterMinutes: dto.overtimeAfterMinutes }),
        ...(dto.weeklyOffDays !== undefined && { weeklyOffDays: [...new Set(dto.weeklyOffDays)].sort() }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      });
      return repo.save(s);
    });
  }

  async removeShift(id: string) {
    const repo = this.dataSource.getRepository(AttendanceShift);
    const s = await repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('لم يتم العثور على الوردية');
    const used = await this.dataSource.getRepository(Employee).count({ where: { shiftId: id } });
    if (used) throw new BadRequestException(`الوردية مستخدمة لـ ${used} موظف — انقلهم لوردية أخرى أولاً`);
    await repo.softDelete(id);
    return { id };
  }

  private assertShiftTimes(start: string, end: string) {
    if (start === end) throw new BadRequestException('وقت البداية يساوي وقت النهاية');
  }

  // ── holidays ─────────────────────────────────────────
  listHolidays(q: HolidayQueryDto) {
    const qb = this.dataSource.getRepository(AttendanceHoliday).createQueryBuilder('h');
    const year = q.year ?? Number(cairoToday().slice(0, 4));
    qb.where('YEAR(h.holidayDate) = :y', { y: year }).orderBy('h.holidayDate', 'ASC');
    return qb.getMany();
  }

  async createHoliday(dto: CreateHolidayDto) {
    const from = dto.holidayDate.slice(0, 10);
    const to = (dto.toDate ?? dto.holidayDate).slice(0, 10);
    if (to < from) throw new BadRequestException('تاريخ النهاية قبل البداية');
    const repo = this.dataSource.getRepository(AttendanceHoliday);
    const rows: AttendanceHoliday[] = [];
    for (let d = from, i = 0; d <= to; d = addDays(d, 1), i++) {
      if (i >= 31) throw new BadRequestException('الإجازة لا تزيد عن 31 يوماً');
      const exists = await repo.findOne({ where: { holidayDate: d, branchId: dto.branchId ? dto.branchId : IsNull() } });
      if (exists) continue;
      rows.push(repo.create({ holidayDate: d, name: dto.name.trim(), branchId: dto.branchId ?? null }));
    }
    return repo.save(rows);
  }

  async removeHoliday(id: string) {
    const r = await this.dataSource.getRepository(AttendanceHoliday).delete(id);
    if (!r.affected) throw new NotFoundException('لم يتم العثور على الإجازة');
    return { id };
  }

  // ── branch locations ─────────────────────────────────
  async branchLocations(scope: BranchScope) {
    const rows = await this.dataSource.getRepository(Branch).find({ where: { isActive: true }, order: { name: 'ASC' } });
    return rows
      .filter((b) => isWithinBranchScope(b.id, scope))
      .map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        address: b.address,
        latitude: b.latitude === null ? null : Number(b.latitude),
        longitude: b.longitude === null ? null : Number(b.longitude),
        attendanceRadiusM: b.attendanceRadiusM,
      }));
  }

  async setBranchLocation(branchId: string, dto: BranchLocationDto, scope: BranchScope) {
    if (!isWithinBranchScope(branchId, scope)) throw new ForbiddenException('لا يمكنك العمل على فرع غير مخصّص لك');
    const repo = this.dataSource.getRepository(Branch);
    const b = await repo.findOne({ where: { id: branchId } });
    if (!b) throw new NotFoundException('لم يتم العثور على الفرع');
    const lat = dto.latitude === undefined ? b.latitude : dto.latitude;
    const lng = dto.longitude === undefined ? b.longitude : dto.longitude;
    if ((lat === null) !== (lng === null)) throw new BadRequestException('أدخل خط العرض وخط الطول معاً');
    await repo.update(branchId, {
      latitude: lat,
      longitude: lng,
      ...(dto.attendanceRadiusM !== undefined && { attendanceRadiusM: dto.attendanceRadiusM }),
    });
    return (await this.branchLocations(null)).find((x) => x.id === branchId);
  }

  // ── employees ────────────────────────────────────────
  /** Employees the caller can see: serving a branch in scope, or serving all branches. */
  scopedEmployees(scope: BranchScope, branchId?: string): SelectQueryBuilder<Employee> {
    const qb = this.dataSource.getRepository(Employee).createQueryBuilder('e');
    if (scope !== null) {
      if (!scope.length) qb.andWhere('1 = 0');
      else
        qb.andWhere(
          new Brackets((w) =>
            w
              .where('EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id IN (:...sc))', { sc: scope })
              .orWhere('NOT EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id)'),
          ),
        );
    }
    if (branchId) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('EXISTS (SELECT 1 FROM employee_branches eb3 WHERE eb3.employee_id = e.id AND eb3.branch_id = :fb)', { fb: branchId })
            .orWhere('NOT EXISTS (SELECT 1 FROM employee_branches eb4 WHERE eb4.employee_id = e.id)'),
        ),
      );
    }
    return qb;
  }

  private async withBranches(list: Employee[]): Promise<EmpRow[]> {
    if (!list.length) return [];
    const ids = list.map((e) => e.id);
    const rows: { employee_id: string; branch_id: string; name: string }[] = await this.dataSource.query(
      `SELECT eb.employee_id, eb.branch_id, b.name FROM employee_branches eb JOIN branches b ON b.id = eb.branch_id
       WHERE eb.employee_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    return list.map((e) => {
      const mine = rows.filter((r) => r.employee_id === e.id);
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        jobTitle: e.jobTitle,
        mobile: e.mobile,
        shiftId: e.shiftId,
        hireDate: e.hireDate,
        exitDate: e.exitDate,
        attendanceEnabled: e.attendanceEnabled,
        isActive: e.isActive,
        branchIds: mine.map((r) => r.branch_id),
        branchNames: mine.map((r) => r.name),
      };
    });
  }

  /** Active employees in scope with their attendance setup. */
  async employees(q: AttendanceEmployeesQueryDto, scope: BranchScope) {
    const qb = this.scopedEmployees(scope, q.branchId).addSelect('e.attendancePinHash').andWhere('e.isActive = 1');
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s OR e.mobile LIKE :s)', { s: `%${q.search}%` });
    const list = await qb.orderBy('e.name', 'ASC').getMany();
    const shifts = await this.calc.shiftsById();
    const def = await this.calc.defaultShift();
    const base = await this.withBranches(list);
    return base.map((r, i) => {
      const e = list[i];
      const shift = (r.shiftId && shifts.get(r.shiftId)) || null;
      return {
        ...r,
        shiftName: shift?.name ?? null,
        effectiveShiftName: shift?.name ?? def?.name ?? null,
        hasPin: !!e.attendancePinHash,
        isLocked: !!e.attendanceLockedUntil && new Date(e.attendanceLockedUntil).getTime() > Date.now(),
        appPermissions: appFeaturesOf(e),
      };
    });
  }

  async employeeSetup(id: string, scope: BranchScope) {
    const list = await this.scopedEmployees(scope).addSelect('e.attendancePinHash').andWhere('e.id = :id', { id }).getMany();
    if (!list.length) throw new NotFoundException('لم يتم العثور على الموظف');
    const e = list[0];
    const shift = await this.calc.shiftFor(e.shiftId);
    return {
      employeeId: e.id,
      mobile: e.mobile,
      shiftId: e.shiftId,
      effectiveShift: shift ? { id: shift.id, name: shift.name, startTime: shift.startTime, endTime: shift.endTime } : null,
      attendanceEnabled: e.attendanceEnabled,
      hasPin: !!e.attendancePinHash,
      pinChangedAt: e.attendancePinChangedAt,
      isLocked: !!e.attendanceLockedUntil && new Date(e.attendanceLockedUntil).getTime() > Date.now(),
      appPermissions: appFeaturesOf(e),
    };
  }

  async updateEmployeeSetup(id: string, dto: EmployeeAttendanceSetupDto, scope: BranchScope) {
    const list = await this.scopedEmployees(scope).addSelect('e.attendancePinHash').andWhere('e.id = :id', { id }).getMany();
    const e = list[0];
    if (!e) throw new NotFoundException('لم يتم العثور على الموظف');
    const patch: Partial<Employee> = {};

    if (dto.shiftId !== undefined) {
      if (dto.shiftId) {
        const s = await this.dataSource.getRepository(AttendanceShift).findOne({ where: { id: dto.shiftId } });
        if (!s) throw new BadRequestException('الوردية غير موجودة');
      }
      patch.shiftId = dto.shiftId || null;
    }
    if (dto.pin) {
      patch.attendancePinHash = await bcrypt.hash(dto.pin, 10);
      patch.attendancePinChangedAt = nowSeconds(); // signs the old phones out
      patch.attendancePinFailedCount = 0;
      patch.attendanceLockedUntil = null;
    }
    if (dto.appPermissions !== undefined) patch.appPermissions = [...new Set(dto.appPermissions)];
    if (dto.unlock) {
      patch.attendancePinFailedCount = 0;
      patch.attendanceLockedUntil = null;
    }
    const enabled = dto.attendanceEnabled ?? e.attendanceEnabled;
    if (dto.attendanceEnabled !== undefined) patch.attendanceEnabled = dto.attendanceEnabled;
    if (enabled) {
      const n = normalizeMobile(e.mobile);
      if (n.length < 8) throw new BadRequestException('سجّل رقم موبايل الموظف في ملفه أولاً — به يدخل على التطبيق');
      if (!e.attendancePinHash && !dto.pin) throw new BadRequestException('حدّد رمز الدخول (PIN) للموظف');
      const others = await this.dataSource
        .getRepository(Employee)
        .createQueryBuilder('o')
        .where('o.attendanceEnabled = 1')
        .andWhere('o.id <> :id', { id: e.id })
        .andWhere('o.mobile IS NOT NULL')
        .getMany();
      const dup = others.find((o) => normalizeMobile(o.mobile) === n);
      if (dup) throw new BadRequestException(`رقم الموبايل مستخدم لموظف آخر في التطبيق: ${dup.name}`);
    }
    if (dto.attendanceEnabled === false) patch.attendancePinChangedAt = nowSeconds(); // sign out at once
    if (Object.keys(patch).length) await this.dataSource.getRepository(Employee).update(e.id, patch);
    return this.employeeSetup(e.id, scope);
  }

  // ── punches ──────────────────────────────────────────
  async punches(q: PunchQueryDto, scope: BranchScope) {
    const qb = this.dataSource
      .getRepository(AttendancePunch)
      .createQueryBuilder('p')
      .innerJoin('p.employee', 'e')
      .addSelect(['e.id', 'e.code', 'e.name']);
    this.scopeOnPunchEmployees(qb, scope);
    if (q.from) qb.andWhere('p.workDate >= :from', { from: q.from.slice(0, 10) });
    if (q.to) qb.andWhere('p.workDate <= :to', { to: q.to.slice(0, 10) });
    if (q.employeeId) qb.andWhere('p.employeeId = :emp', { emp: q.employeeId });
    if (q.branchId) qb.andWhere('p.branchId = :br', { br: q.branchId });
    if (q.status) qb.andWhere('p.status = :st', { st: q.status });
    if (q.source) qb.andWhere('p.source = :src', { src: q.source });
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s)', { s: `%${q.search}%` });
    qb.orderBy('p.punchedAt', 'DESC').skip(q.skip).take(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(
      items.map((p) => ({ ...p, employeeCode: p.employee?.code, employeeName: p.employee?.name, employee: undefined })),
      total,
      q.page,
      q.perPage,
    );
  }

  private scopeOnPunchEmployees(qb: SelectQueryBuilder<AttendancePunch>, scope: BranchScope) {
    if (scope === null) return;
    if (!scope.length) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(
      new Brackets((w) =>
        w
          .where('p.branchId IN (:...sc)', { sc: scope })
          .orWhere('EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id IN (:...sc))', { sc: scope })
          .orWhere('NOT EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id)'),
      ),
    );
  }

  /** HR adds a missed check-in / check-out (source «manual», reason kept). */
  async addManualPunch(dto: ManualPunchDto, userId: string | undefined, scope: BranchScope) {
    const emp = await this.scopedEmployees(scope).andWhere('e.id = :id', { id: dto.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على الموظف');
    const workDate = dto.workDate.slice(0, 10);
    const day = dto.nextDay ? addDays(workDate, 1) : workDate;
    const at = cairoToUtc(day, dto.time);
    if (at.getTime() > Date.now() + 60_000) throw new BadRequestException('لا يمكن تسجيل بصمة في المستقبل');
    let branchName: string | null = null;
    if (dto.branchId) {
      const b = await this.dataSource.getRepository(Branch).findOne({ where: { id: dto.branchId } });
      if (!b) throw new BadRequestException('الفرع غير موجود');
      branchName = b.name;
    }
    const shift = await this.calc.shiftFor(emp.shiftId);
    const repo = this.dataSource.getRepository(AttendancePunch);
    return repo.save(
      repo.create({
        employeeId: emp.id,
        punchType: dto.punchType,
        punchedAt: at,
        workDate,
        localTime: cairoParts(at).time,
        source: PunchSource.MANUAL,
        status: PunchStatus.ACCEPTED,
        branchId: dto.branchId ?? null,
        branchName,
        shiftId: shift?.id ?? null,
        note: dto.reason.trim(),
        createdByUserId: userId ?? null,
      }),
    );
  }

  /** HR cancels a wrong punch (kept, marked «voided» with the reason). */
  async voidPunch(id: string, dto: VoidPunchDto, userId: string | undefined, scope: BranchScope) {
    const repo = this.dataSource.getRepository(AttendancePunch);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('لم يتم العثور على البصمة');
    const emp = await this.scopedEmployees(scope).andWhere('e.id = :id', { id: p.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على البصمة');
    if (p.status === PunchStatus.VOIDED) throw new BadRequestException('البصمة ملغاة بالفعل');
    if (p.status === PunchStatus.REJECTED) throw new BadRequestException('البصمة مرفوضة أصلاً ولا تُحتسب');
    await repo.update(id, { status: PunchStatus.VOIDED, voidedAt: new Date(), voidedByUserId: userId ?? null, voidReason: dto.reason.trim() });
    return repo.findOne({ where: { id } });
  }

  /** Accept a refused attempt anyway (e.g. a weak GPS reading at the door). */
  async approvePunch(id: string, dto: VoidPunchDto, userId: string | undefined, scope: BranchScope) {
    const repo = this.dataSource.getRepository(AttendancePunch);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('لم يتم العثور على البصمة');
    const emp = await this.scopedEmployees(scope).andWhere('e.id = :id', { id: p.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على البصمة');
    if (p.status !== PunchStatus.REJECTED) throw new BadRequestException('يمكن اعتماد البصمات المرفوضة فقط');
    await repo.update(id, {
      status: PunchStatus.ACCEPTED,
      note: `اعتماد يدوي: ${dto.reason.trim()} (السبب الأصلي: ${p.rejectReason ?? '—'})`,
      createdByUserId: userId ?? null,
    });
    return repo.findOne({ where: { id } });
  }

  // ── reports ──────────────────────────────────────────
  /** Today's (or a date's) board: one row per employee + counts. */
  async daily(q: DailyBoardQueryDto, scope: BranchScope) {
    const date = (q.date ?? cairoToday()).slice(0, 10);
    const list = await this.scopedEmployees(scope, q.branchId).andWhere('e.isActive = 1').orderBy('e.name', 'ASC').getMany();
    const emps = await this.withBranches(list);
    const days = await this.calc.computeDays(emps, date, date);
    const rows = emps
      .map((e) => ({ employee: this.empLite(e), day: days.get(e.id)![0] }))
      .filter((r) => r.day.status !== AttendanceDayStatus.NOT_EMPLOYED);
    const S = AttendanceDayStatus;
    const count = (...st: AttendanceDayStatus[]) => rows.filter((r) => st.includes(r.day.status)).length;
    return {
      date,
      today: cairoToday(),
      summary: {
        total: rows.length,
        present: count(S.PRESENT, S.WORKING, S.INCOMPLETE),
        working: count(S.WORKING),
        late: rows.filter((r) => r.day.lateMinutes > 0).length,
        absent: count(S.ABSENT),
        pending: count(S.PENDING),
        off: count(S.WEEKLY_OFF, S.HOLIDAY),
        incomplete: count(S.INCOMPLETE),
        noShift: count(S.NO_SHIFT),
      },
      rows,
    };
  }

  /** Month totals per employee. */
  async monthly(q: MonthlyQueryDto, scope: BranchScope) {
    const { from, to } = monthRange(q.month);
    const qb = this.scopedEmployees(scope, q.branchId).orderBy('e.name', 'ASC');
    if (q.employeeId) qb.andWhere('e.id = :eid', { eid: q.employeeId });
    // Active now, or still employed at some point of the month.
    qb.andWhere('(e.isActive = 1 OR e.exitDate >= :mf)', { mf: from });
    const emps = await this.withBranches(await qb.getMany());
    const days = await this.calc.computeDays(emps, from, to);
    const rows = emps.map((e) => ({ employee: this.empLite(e), totals: this.calc.totals(days.get(e.id) ?? []) }));
    const sum = (k: keyof (typeof rows)[number]['totals']) => rows.reduce((a, r) => a + r.totals[k], 0);
    return {
      month: q.month,
      from,
      to,
      rows,
      totals: {
        absentDays: sum('absentDays'),
        lateMinutes: sum('lateMinutes'),
        earlyLeaveMinutes: sum('earlyLeaveMinutes'),
        overtimeMinutes: sum('overtimeMinutes'),
        workedMinutes: sum('workedMinutes'),
      },
    };
  }

  /** One employee's month, day by day (employee file tab). */
  async employeeMonth(employeeId: string, month: string, scope: BranchScope) {
    const list = await this.scopedEmployees(scope).andWhere('e.id = :id', { id: employeeId }).getMany();
    if (!list.length) throw new NotFoundException('لم يتم العثور على الموظف');
    return this.monthOf((await this.withBranches(list))[0], month);
  }

  /** Shared with the employee app. */
  async monthOf(e: EmpRow | Employee, month: string): Promise<{ month: string; days: AttendanceDay[]; totals: ReturnType<AttendanceCalcService['totals']> }> {
    const { from, to } = monthRange(month);
    const days = (await this.calc.computeDays([e], from, to)).get(e.id) ?? [];
    return { month, days, totals: this.calc.totals(days) };
  }

  settings() {
    return { timezone: 'Africa/Cairo', today: cairoToday(), now: cairoParts().time, maxAccuracyM: maxAccuracyM() };
  }

  private empLite(e: EmpRow) {
    return { id: e.id, code: e.code, name: e.name, jobTitle: e.jobTitle, branchNames: e.branchNames, attendanceEnabled: e.attendanceEnabled };
  }
}
