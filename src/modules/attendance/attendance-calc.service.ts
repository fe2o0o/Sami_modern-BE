import { Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { AttendanceShift } from './entities/attendance-shift.entity';
import { AttendanceHoliday } from './entities/attendance-holiday.entity';
import { AttendancePunch } from './entities/attendance-punch.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { AttendancePermission } from './entities/attendance-permission.entity';
import { AttendanceDayStatus, LeaveRequestStatus, PERMISSION_TYPE_LABELS, PermissionType, PunchStatus, PunchType } from './attendance.enum';
import { addDays, cairoParts, hhmmToMinutes, minutesToHhmm, weekdayOf } from './attendance-time.util';

/** One employee-day, computed from the accepted punches (Cairo time). */
export interface AttendanceDay {
  date: string;
  weekday: number;
  status: AttendanceDayStatus;
  shiftId: string | null;
  shiftName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  holidayName: string | null;
  /** Approved leave covering the day (its type name). */
  leaveName: string | null;
  /** "HH:mm" of the first check-in / last check-out. */
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  punchCount: number;
  branchName: string | null;
  /** Approved permissions of the day («مأمورية 10:00–12:00 · إذن شخصي 09:00–10:00»). */
  permissionNote: string | null;
  /** Minutes credited as work by approved missions (already inside workedMinutes). */
  missionMinutes: number;
}

type Interval = [number, number];
/** Merge overlapping intervals. */
function union(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const lengthOf = (list: Interval[]) => union(list).reduce((s, [a, b]) => s + (b - a), 0);
/** Minutes of [a, b] NOT covered by `cover`. */
function uncovered(a: number, b: number, cover: Interval[]): number {
  if (b <= a) return 0;
  const inside = union(cover).reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  return Math.max(0, b - a - inside);
}

export interface AttendanceTotals {
  workingDays: number;
  presentDays: number;
  absentDays: number;
  incompleteDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveDays: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
  weeklyOffDays: number;
  holidayDays: number;
  leaveDays: number;
}

/** Punches after midnight up to this many minutes past an overnight shift's end belong to the previous day. */
const OVERNIGHT_TAIL_MINUTES = 6 * 60;
/** A check-in still open this long after the shift end is "no check-out" rather than "working". */
const OPEN_TAIL_MINUTES = 6 * 60;

type EmployeeLite = Pick<Employee, 'id' | 'shiftId' | 'hireDate' | 'exitDate'> & { branchIds?: string[] };

@Injectable()
export class AttendanceCalcService {
  constructor(private readonly dataSource: DataSource) {}

  async shiftsById(): Promise<Map<string, AttendanceShift>> {
    const all = await this.dataSource.getRepository(AttendanceShift).find({ withDeleted: true });
    return new Map(all.map((s) => [s.id, s]));
  }

  async defaultShift(): Promise<AttendanceShift | null> {
    return this.dataSource.getRepository(AttendanceShift).findOne({ where: { isDefault: true, isActive: true, deletedAt: IsNull() } });
  }

  /** The shift that applies to an employee now (own shift, else the default). */
  async shiftFor(shiftId: string | null): Promise<AttendanceShift | null> {
    if (shiftId) {
      const own = await this.dataSource.getRepository(AttendanceShift).findOne({ where: { id: shiftId } });
      if (own) return own;
    }
    return this.defaultShift();
  }

  /** The Cairo work date of a punch at `at` (an overnight shift's early-morning punches → the day before). */
  workDateFor(shift: AttendanceShift | null, at: Date): string {
    const p = cairoParts(at);
    if (shift) {
      const start = hhmmToMinutes(shift.startTime)!;
      const end = hhmmToMinutes(shift.endTime)!;
      if (end < start && p.minutes < Math.min(end + OVERNIGHT_TAIL_MINUTES, start - 60)) return addDays(p.date, -1);
    }
    return p.date;
  }

  /**
   * Day-by-day attendance of `employees` between `from` and `to` (inclusive).
   * Days after today are returned as «pending» and never counted.
   */
  async computeDays(employees: EmployeeLite[], from: string, to: string): Promise<Map<string, AttendanceDay[]>> {
    const out = new Map<string, AttendanceDay[]>();
    if (!employees.length) return out;
    const ids = employees.map((e) => e.id);

    const [shifts, defShift, punches, holidays, leaves, permissions] = await Promise.all([
      this.shiftsById(),
      this.defaultShift(),
      this.dataSource
        .getRepository(AttendancePunch)
        .createQueryBuilder('p')
        .where('p.employeeId IN (:...ids)', { ids })
        .andWhere('p.status = :s', { s: PunchStatus.ACCEPTED })
        .andWhere('p.workDate BETWEEN :from AND :to', { from, to })
        .orderBy('p.punchedAt', 'ASC')
        .getMany(),
      this.dataSource
        .getRepository(AttendanceHoliday)
        .createQueryBuilder('h')
        .where('h.holidayDate BETWEEN :from AND :to', { from, to })
        .getMany(),
      this.dataSource
        .getRepository(LeaveRequest)
        .createQueryBuilder('l')
        .where('l.employeeId IN (:...ids)', { ids })
        .andWhere('l.status = :ls', { ls: LeaveRequestStatus.APPROVED })
        .andWhere('l.fromDate <= :to AND l.toDate >= :from', { from, to })
        .getMany(),
      this.dataSource
        .getRepository(AttendancePermission)
        .createQueryBuilder('x')
        .where('x.employeeId IN (:...ids)', { ids })
        .andWhere('x.status = :xs', { xs: LeaveRequestStatus.APPROVED })
        .andWhere('x.permissionDate BETWEEN :from AND :to', { from, to })
        .getMany(),
    ]);

    // Branch memberships (for branch-only holidays), loaded once when not supplied.
    const needBranches = employees.some((e) => !e.branchIds);
    const branchMap = new Map<string, string[]>();
    if (needBranches && holidays.some((h) => h.branchId)) {
      const rows: { employee_id: string; branch_id: string }[] = await this.dataSource.query(
        `SELECT employee_id, branch_id FROM employee_branches WHERE employee_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      for (const r of rows) branchMap.set(r.employee_id, [...(branchMap.get(r.employee_id) ?? []), r.branch_id]);
    }

    const byEmpDate = new Map<string, AttendancePunch[]>();
    for (const p of punches) {
      const k = `${p.employeeId}|${p.workDate}`;
      const arr = byEmpDate.get(k);
      if (arr) arr.push(p);
      else byEmpDate.set(k, [p]);
    }

    const now = cairoParts();
    for (const e of employees) {
      const branchIds = e.branchIds ?? branchMap.get(e.id) ?? [];
      const days: AttendanceDay[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const dayPunches = byEmpDate.get(`${e.id}|${d}`) ?? [];
        const shift =
          (dayPunches[0]?.shiftId ? shifts.get(dayPunches[0].shiftId) : undefined) ??
          (e.shiftId ? shifts.get(e.shiftId) : undefined) ??
          defShift ??
          null;
        const holiday = holidays.find((h) => h.holidayDate === d && (!h.branchId || branchIds.includes(h.branchId))) ?? null;
        const leave = leaves.find((l) => l.employeeId === e.id && l.fromDate <= d && l.toDate >= d) ?? null;
        const dayPermissions = permissions.filter((x) => x.employeeId === e.id && x.permissionDate === d);
        days.push(this.computeDay(e, d, shift, holiday, dayPunches, now, leave, dayPermissions));
      }
      out.set(e.id, days);
    }
    return out;
  }

  private computeDay(
    e: EmployeeLite,
    date: string,
    shift: AttendanceShift | null,
    holiday: AttendanceHoliday | null,
    punches: AttendancePunch[],
    now: { date: string; minutes: number },
    leave: LeaveRequest | null = null,
    permissions: AttendancePermission[] = [],
  ): AttendanceDay {
    const weekday = weekdayOf(date);
    const start = shift ? hhmmToMinutes(shift.startTime)! : null;
    let end = shift ? hhmmToMinutes(shift.endTime)! : null;
    if (start !== null && end !== null && end <= start) end += 1440;

    const day: AttendanceDay = {
      date,
      weekday,
      status: AttendanceDayStatus.PENDING,
      shiftId: shift?.id ?? null,
      shiftName: shift?.name ?? null,
      scheduledStart: shift?.startTime ?? null,
      scheduledEnd: shift?.endTime ?? null,
      holidayName: holiday?.name ?? null,
      leaveName: null,
      firstIn: null,
      lastOut: null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      punchCount: punches.length,
      branchName: punches.find((p) => p.branchName)?.branchName ?? null,
      permissionNote: permissions.length
        ? permissions
            .map((x) => `${PERMISSION_TYPE_LABELS[x.permissionType]}${x.fullDay ? ' (يوم كامل)' : ` ${x.fromTime}–${x.toTime}`}`)
            .join(' · ')
        : null,
      missionMinutes: 0,
    };

    if ((e.hireDate && date < e.hireDate) || (e.exitDate && date > e.exitDate)) {
      day.status = AttendanceDayStatus.NOT_EMPLOYED;
      return day;
    }

    // Minutes since the work date's midnight (an after-midnight punch → +1440).
    const rel = (p: AttendancePunch) => {
      const c = cairoParts(p.punchedAt);
      return c.minutes + (c.date > date ? 1440 : 0) + Number(c.time.slice(6, 8)) / 60;
    };
    const nowRel = now.date === date ? now.minutes : now.date > date ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

    // Pair IN → OUT.
    let open: number | null = null;
    let first: number | null = null;
    let last: number | null = null;
    let worked = 0;
    const pairs: Interval[] = [];
    for (const p of punches) {
      const m = rel(p);
      if (p.punchType === PunchType.IN) {
        if (open === null) open = m;
        if (first === null) first = m;
      } else if (open !== null) {
        worked += m - open;
        pairs.push([open, m]);
        open = null;
        last = m;
      }
    }
    day.firstIn = first !== null ? minutesToHhmm(Math.floor(first)) : null;
    day.lastOut = last !== null ? minutesToHhmm(Math.floor(last)) : null;
    day.workedMinutes = Math.floor(worked);

    const isOff = !!shift && (shift.weeklyOffDays ?? []).includes(weekday);
    if (holiday || isOff) {
      day.status = holiday ? AttendanceDayStatus.HOLIDAY : AttendanceDayStatus.WEEKLY_OFF;
      // Working on a day off is all overtime.
      day.overtimeMinutes = day.workedMinutes;
      return day;
    }

    if (leave) {
      day.status = AttendanceDayStatus.LEAVE;
      day.leaveName = leave.leaveTypeName;
      return day;
    }

    const openStatus = () =>
      nowRel <= (end ?? 1440) + OPEN_TAIL_MINUTES ? AttendanceDayStatus.WORKING : AttendanceDayStatus.INCOMPLETE;

    if (!shift || start === null || end === null) {
      day.status =
        first === null ? AttendanceDayStatus.NO_SHIFT : open !== null ? openStatus() : AttendanceDayStatus.PRESENT;
      return day;
    }

    // Approved permissions as intervals on the work date's minute axis (an overnight
    // shift's after-midnight times → +1440). Missions = presence; both excuse lateness / early leave.
    const at = (t: string | null) => {
      const m = hhmmToMinutes(t)!;
      return end > 1440 && m < start ? m + 1440 : m;
    };
    const toInterval = (x: AttendancePermission): Interval => {
      if (x.fullDay) return [start, end];
      const a = at(x.fromTime);
      let b = at(x.toTime);
      if (b <= a) b += 1440;
      return [a, b];
    };
    const missions = permissions.filter((x) => x.permissionType === PermissionType.MISSION).map(toInterval);
    const excused = permissions.map(toInterval);

    if (first === null && !missions.length) {
      day.status = nowRel > end ? AttendanceDayStatus.ABSENT : AttendanceDayStatus.PENDING;
      return day;
    }

    // Presence = punched pairs ∪ missions: first arrival, last departure, worked time.
    const presence = union([...pairs, ...missions]);
    if (missions.length) {
      const all = lengthOf(presence);
      day.missionMinutes = Math.floor(all - lengthOf(pairs));
      day.workedMinutes = Math.floor(all);
    }
    const firstAt = Math.min(first ?? Number.POSITIVE_INFINITY, ...missions.map(([a]) => a));
    const missionEnd = missions.length ? Math.max(...missions.map(([, b]) => b)) : null;
    const lastAt = open !== null ? null : Math.max(last ?? Number.NEGATIVE_INFINITY, missionEnd ?? Number.NEGATIVE_INFINITY);
    if (first === null) day.firstIn = null;

    const late = Math.floor(uncovered(start, firstAt, excused));
    day.lateMinutes = late > (shift.lateGraceMinutes ?? 0) ? late : 0;
    if (lastAt !== null && Number.isFinite(lastAt)) {
      const early = Math.floor(uncovered(lastAt, end, excused));
      day.earlyLeaveMinutes = early > (shift.earlyLeaveGraceMinutes ?? 0) ? early : 0;
      // Overtime = time after the shift end, but only once the shift's hours are complete:
      // a late arrival / personal permission is made up first (missions count as work).
      // Only real punches after the end count (a mission ending late is not overtime).
      if (last !== null) {
        const afterEnd = Math.floor(last - end);
        const beyondShift = Math.floor(day.workedMinutes - (end - start));
        const over = Math.min(afterEnd, beyondShift);
        day.overtimeMinutes = over > 0 && over >= (shift.overtimeAfterMinutes ?? 0) ? over : 0;
      }
    }
    day.status = open !== null ? openStatus() : AttendanceDayStatus.PRESENT;
    return day;
  }

  /** Month / period totals (pending and not-employed days are not counted). */
  totals(days: AttendanceDay[]): AttendanceTotals {
    const t: AttendanceTotals = {
      workingDays: 0,
      presentDays: 0,
      absentDays: 0,
      incompleteDays: 0,
      lateDays: 0,
      lateMinutes: 0,
      earlyLeaveDays: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      workedMinutes: 0,
      weeklyOffDays: 0,
      holidayDays: 0,
      leaveDays: 0,
    };
    const S = AttendanceDayStatus;
    for (const d of days) {
      if (d.status === S.PENDING || d.status === S.NOT_EMPLOYED) continue;
      if (d.status === S.WEEKLY_OFF) t.weeklyOffDays++;
      else if (d.status === S.HOLIDAY) t.holidayDays++;
      else if (d.status === S.LEAVE) t.leaveDays++;
      else if (d.status !== S.NO_SHIFT || d.punchCount) t.workingDays++;
      if (d.status === S.PRESENT || d.status === S.WORKING || d.status === S.INCOMPLETE) t.presentDays++;
      if (d.status === S.ABSENT) t.absentDays++;
      if (d.status === S.INCOMPLETE) t.incompleteDays++;
      if (d.lateMinutes > 0) t.lateDays++;
      if (d.earlyLeaveMinutes > 0) t.earlyLeaveDays++;
      t.lateMinutes += d.lateMinutes;
      t.earlyLeaveMinutes += d.earlyLeaveMinutes;
      t.overtimeMinutes += d.overtimeMinutes;
      t.workedMinutes += d.workedMinutes;
    }
    return t;
  }

  /** Accepted punches of one employee-day (oldest first). */
  dayPunches(employeeId: string, workDate: string) {
    return this.dataSource.getRepository(AttendancePunch).find({
      where: { employeeId, workDate, status: In([PunchStatus.ACCEPTED]) },
      order: { punchedAt: 'ASC' },
    });
  }
}
