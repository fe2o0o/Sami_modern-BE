import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { BranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AttendancePermission } from './entities/attendance-permission.entity';
import { AttendanceSetting } from './entities/attendance-setting.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { AttendanceCalcService } from './attendance-calc.service';
import { AttendanceService } from './attendance.service';
import { AttendanceDayStatus, LeaveRequestStatus, PERMISSION_TYPE_LABELS, PermissionType, RequestSource } from './attendance.enum';
import { addDays, cairoToday, hhmmToMinutes, monthRange } from './attendance-time.util';
import { CreatePermissionDto, PermissionBodyDto, PermissionSettingsDto, PermissionsQueryDto } from './dto/permission.dto';
import { DecisionDto } from './dto/leave.dto';

const ACTIVE = [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED];
/** How far back / ahead a permission may be requested. */
const PAST_DAYS = 30;
const AHEAD_DAYS = 60;
const MAX_MINUTES = 12 * 60;

export interface PermissionBalance {
  month: string;
  /** null = no monthly cap. */
  capMinutes: number | null;
  usedMinutes: number;
  pendingMinutes: number;
  /** cap − used − pending (null when no cap). */
  remainingMinutes: number | null;
}

/**
 * «طلبات الإذن»: mission / personal permissions inside one work day. Approved
 * permissions are applied by AttendanceCalcService (missions count as work; both
 * excuse lateness / early leave inside their time). Personal permissions draw on
 * a monthly hours cap (attendance_settings).
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calc: AttendanceCalcService,
    private readonly attendance: AttendanceService,
  ) {}

  // ── settings ─────────────────────────────────────────
  async settings(): Promise<AttendanceSetting> {
    const repo = this.dataSource.getRepository(AttendanceSetting);
    const row = await repo.findOne({ where: {} });
    return row ?? repo.save(repo.create({ personalPermissionHoursPerMonth: 4 }));
  }

  async saveSettings(dto: PermissionSettingsDto) {
    const s = await this.settings();
    s.personalPermissionHoursPerMonth = dto.personalPermissionHoursPerMonth ?? null;
    return this.dataSource.getRepository(AttendanceSetting).save(s);
  }

  // ── balance ──────────────────────────────────────────
  /** Personal-permission minutes of a month (approved + pending), optionally excluding one request. */
  async balance(employeeId: string, month: string, excludeId?: string): Promise<PermissionBalance> {
    const { from, to } = monthRange(month);
    const qb = this.dataSource
      .getRepository(AttendancePermission)
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COALESCE(SUM(p.minutes), 0)', 'minutes')
      .where('p.employeeId = :e', { e: employeeId })
      .andWhere('p.permissionType = :t', { t: PermissionType.PERSONAL })
      .andWhere('p.status IN (:...st)', { st: ACTIVE })
      .andWhere('p.permissionDate BETWEEN :from AND :to', { from, to })
      .groupBy('p.status');
    if (excludeId) qb.andWhere('p.id <> :x', { x: excludeId });
    const rows = await qb.getRawMany<{ status: string; minutes: string }>();
    const used = Number(rows.find((r) => r.status === LeaveRequestStatus.APPROVED)?.minutes ?? 0);
    const pending = Number(rows.find((r) => r.status === LeaveRequestStatus.PENDING)?.minutes ?? 0);
    const hours = (await this.settings()).personalPermissionHoursPerMonth;
    const capMinutes = hours === null || hours === undefined ? null : Math.round(Number(hours) * 60);
    return { month, capMinutes, usedMinutes: used, pendingMinutes: pending, remainingMinutes: capMinutes === null ? null : capMinutes - used - pending };
  }

  // ── validation ───────────────────────────────────────
  private async validate(emp: Employee, body: PermissionBodyDto, excludeId?: string) {
    const date = body.permissionDate.slice(0, 10);
    const today = cairoToday();
    if (date < addDays(today, -PAST_DAYS)) throw new BadRequestException(`لا يمكن طلب إذن لتاريخ أقدم من ${PAST_DAYS} يوماً`);
    if (date > addDays(today, AHEAD_DAYS)) throw new BadRequestException(`لا يمكن طلب إذن بعد أكثر من ${AHEAD_DAYS} يوماً`);
    const fullDay = body.permissionType === PermissionType.MISSION && !!body.fullDay;
    if (body.fullDay && body.permissionType === PermissionType.PERSONAL) throw new BadRequestException('الإذن الشخصي لا يكون يوماً كاملاً — اطلب إجازة');

    // The day itself: a working day of the employee, not a leave.
    const day = (await this.calc.computeDays([emp], date, date)).get(emp.id)?.[0];
    if (day?.status === AttendanceDayStatus.NOT_EMPLOYED) throw new BadRequestException('الموظف غير معيّن في هذا التاريخ');
    if (day?.status === AttendanceDayStatus.WEEKLY_OFF || day?.status === AttendanceDayStatus.HOLIDAY) {
      throw new BadRequestException('هذا اليوم إجازة (أسبوعية أو رسمية) — لا يحتاج إذن');
    }
    const leave = await this.dataSource
      .getRepository(LeaveRequest)
      .createQueryBuilder('l')
      .where('l.employeeId = :e', { e: emp.id })
      .andWhere('l.status IN (:...st)', { st: ACTIVE })
      .andWhere('l.fromDate <= :d AND l.toDate >= :d', { d: date })
      .getOne();
    if (leave) throw new BadRequestException(`يوجد طلب إجازة «${leave.leaveTypeName}» في هذا اليوم`);

    let fromTime: string | null = null;
    let toTime: string | null = null;
    let minutes: number;
    if (fullDay) {
      const start = hhmmToMinutes(day?.scheduledStart);
      let end = hhmmToMinutes(day?.scheduledEnd);
      if (start !== null && end !== null && end <= start) end += 1440;
      minutes = start !== null && end !== null ? end - start : 8 * 60;
    } else {
      if (!body.fromTime || !body.toTime) throw new BadRequestException('حدد وقت بداية ونهاية الإذن');
      const f = hhmmToMinutes(body.fromTime)!;
      let t = hhmmToMinutes(body.toTime)!;
      // An overnight shift: a «to» earlier than «from» runs past midnight.
      if (t <= f) t += 1440;
      minutes = t - f;
      if (minutes > MAX_MINUTES) throw new BadRequestException('مدة الإذن أطول من 12 ساعة');
      fromTime = body.fromTime;
      toTime = body.toTime;
    }
    if (minutes <= 0) throw new BadRequestException('مدة الإذن غير صحيحة');

    // No overlap with another active permission on the same day.
    const same = await this.dataSource.getRepository(AttendancePermission).find({ where: { employeeId: emp.id, permissionDate: date } });
    const span = (p: { fullDay: boolean; fromTime: string | null; toTime: string | null }): [number, number] => {
      if (p.fullDay) return [0, 2880];
      const a = hhmmToMinutes(p.fromTime)!;
      let b = hhmmToMinutes(p.toTime)!;
      if (b <= a) b += 1440;
      return [a, b];
    };
    const mine = span({ fullDay, fromTime, toTime });
    const clash = same.find((p) => p.id !== excludeId && ACTIVE.includes(p.status) && span(p)[0] < mine[1] && mine[0] < span(p)[1]);
    if (clash) {
      throw new BadRequestException(`يوجد إذن آخر في نفس الوقت (${PERMISSION_TYPE_LABELS[clash.permissionType]}${clash.fullDay ? ' يوم كامل' : ` ${clash.fromTime} – ${clash.toTime}`})`);
    }

    const balance = await this.balance(emp.id, date.slice(0, 7), excludeId);
    return { date, fullDay, fromTime, toTime, minutes, balance };
  }

  private capError(minutes: number, b: PermissionBalance): string | null {
    if (b.remainingMinutes === null) return null;
    if (minutes <= b.remainingMinutes) return null;
    const h = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.max(0, m) % 60).padStart(2, '0')}`;
    return `رصيد الأذونات الشخصية لهذا الشهر ${h(b.remainingMinutes)} ساعة والإذن ${h(minutes)} ساعة`;
  }

  /** Minutes + the personal balance before sending (the app shows it under the form). */
  async preview(emp: Employee, body: PermissionBodyDto) {
    const v = await this.validate(emp, body);
    const personal = body.permissionType === PermissionType.PERSONAL;
    const err = personal ? this.capError(v.minutes, v.balance) : null;
    return { minutes: v.minutes, balance: v.balance, countsAgainstCap: personal, enough: !err, message: err };
  }

  async create(emp: Employee, body: PermissionBodyDto, source: RequestSource, userId: string | null) {
    const v = await this.validate(emp, body);
    if (body.permissionType === PermissionType.PERSONAL) {
      const err = this.capError(v.minutes, v.balance);
      if (err) throw new BadRequestException(err);
    }
    const repo = this.dataSource.getRepository(AttendancePermission);
    return repo.save(
      repo.create({
        employeeId: emp.id,
        permissionType: body.permissionType,
        permissionDate: v.date,
        fullDay: v.fullDay,
        fromTime: v.fromTime,
        toTime: v.toTime,
        minutes: v.minutes,
        reason: body.reason?.trim() || null,
        status: LeaveRequestStatus.PENDING,
        source,
        createdByUserId: userId,
      }),
    );
  }

  async createByHr(dto: CreatePermissionDto, user: AuthenticatedUser, scope: BranchScope) {
    const emp = await this.attendance.scopedEmployees(scope).andWhere('e.id = :id', { id: dto.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على الموظف');
    if (dto.approveNow && !user.isSuperAdmin && !user.permissions.includes('work_permissions.approve')) {
      throw new ForbiddenException('ليس لديك صلاحية لاعتماد الأذونات');
    }
    const p = await this.create(emp, dto, RequestSource.ERP, user.userId);
    return dto.approveNow ? this.decide(p.id, LeaveRequestStatus.APPROVED, { note: null }, user.userId, scope) : p;
  }

  // ── lists ────────────────────────────────────────────
  async mine(employeeId: string, month?: string) {
    const m = month ?? cairoToday().slice(0, 7);
    const [balance, items] = await Promise.all([
      this.balance(employeeId, m),
      this.dataSource.getRepository(AttendancePermission).find({ where: { employeeId }, order: { permissionDate: 'DESC', createdAt: 'DESC' }, take: 100 }),
    ]);
    return { balance, items };
  }

  async list(q: PermissionsQueryDto, scope: BranchScope) {
    const qb = this.dataSource.getRepository(AttendancePermission).createQueryBuilder('p').innerJoin('p.employee', 'e').addSelect(['e.id', 'e.code', 'e.name', 'e.jobTitle']);
    this.scopeOn(qb, scope);
    if (q.branchId) {
      qb.andWhere(
        '(EXISTS (SELECT 1 FROM employee_branches eb3 WHERE eb3.employee_id = e.id AND eb3.branch_id = :fb) OR NOT EXISTS (SELECT 1 FROM employee_branches eb4 WHERE eb4.employee_id = e.id))',
        { fb: q.branchId },
      );
    }
    if (q.status) qb.andWhere('p.status = :st', { st: q.status });
    if (q.permissionType) qb.andWhere('p.permissionType = :pt', { pt: q.permissionType });
    if (q.employeeId) qb.andWhere('p.employeeId = :emp', { emp: q.employeeId });
    if (q.from) qb.andWhere('p.permissionDate >= :from', { from: q.from.slice(0, 10) });
    if (q.to) qb.andWhere('p.permissionDate <= :to', { to: q.to.slice(0, 10) });
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s)', { s: `%${q.search}%` });
    qb.addSelect(`CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END`, 'status_rank')
      .orderBy('status_rank', 'ASC')
      .addOrderBy('p.permissionDate', 'DESC')
      .addOrderBy('p.fromTime', 'ASC')
      .offset(q.skip)
      .limit(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(
      items.map(({ employee, ...rest }) => ({ ...rest, employeeCode: employee?.code, employeeName: employee?.name, jobTitle: employee?.jobTitle ?? null })),
      total,
      q.page,
      q.perPage,
    );
  }

  pendingCount(scope: BranchScope) {
    const qb = this.dataSource.getRepository(AttendancePermission).createQueryBuilder('p').innerJoin('p.employee', 'e').where('p.status = :st', { st: LeaveRequestStatus.PENDING });
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

  // ── decisions ────────────────────────────────────────
  /** Approve / reject a pending permission, or cancel a pending / approved one (HR). */
  async decide(id: string, to: LeaveRequestStatus, dto: DecisionDto, userId: string | undefined, scope: BranchScope) {
    const repo = this.dataSource.getRepository(AttendancePermission);
    const p = await repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('لم يتم العثور على الإذن');
    const emp = await this.attendance.scopedEmployees(scope).andWhere('e.id = :id', { id: p.employeeId }).getOne();
    if (!emp) throw new NotFoundException('لم يتم العثور على الإذن');

    if (to === LeaveRequestStatus.CANCELLED) {
      if (!ACTIVE.includes(p.status)) throw new BadRequestException('لا يمكن إلغاء هذا الإذن');
    } else if (p.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('الإذن تم البت فيه بالفعل');
    }
    if (to === LeaveRequestStatus.APPROVED && p.permissionType === PermissionType.PERSONAL) {
      // Re-check the cap with only the APPROVED minutes of the month (other approvals may have happened).
      const b = await this.balance(p.employeeId, p.permissionDate.slice(0, 7), p.id);
      const approvedLeft = b.capMinutes === null ? null : b.capMinutes - b.usedMinutes;
      if (approvedLeft !== null && p.minutes > approvedLeft) {
        const err = this.capError(p.minutes, { ...b, pendingMinutes: 0, remainingMinutes: approvedLeft });
        throw new BadRequestException(`${err} — ارفض الطلب أو زد الحد الشهري من إعدادات الأذونات`);
      }
    }
    if (to === LeaveRequestStatus.REJECTED && !dto.note?.trim()) throw new BadRequestException('اكتب سبب الرفض');

    await repo.update(id, { status: to, decidedByUserId: userId ?? null, decidedAt: new Date(), decisionNote: dto.note?.trim() || null });
    return repo.findOne({ where: { id } });
  }

  /** The employee withdraws a request that is still pending. */
  async cancelMine(employeeId: string, id: string) {
    const repo = this.dataSource.getRepository(AttendancePermission);
    const p = await repo.findOne({ where: { id, employeeId } });
    if (!p) throw new NotFoundException('لم يتم العثور على الإذن');
    if (p.status !== LeaveRequestStatus.PENDING) throw new BadRequestException('يمكن سحب الطلب قبل البت فيه فقط');
    await repo.update(id, { status: LeaveRequestStatus.CANCELLED, decidedAt: new Date(), decisionNote: 'سحبه الموظف' });
    return repo.findOne({ where: { id } });
  }
}
