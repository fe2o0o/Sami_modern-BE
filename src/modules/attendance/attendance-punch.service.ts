import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Branch } from '../branch/entities/branch.entity';
import { Employee } from '../employee/entities/employee.entity';
import { AttendancePunch } from './entities/attendance-punch.entity';
import { AttendanceCalcService } from './attendance-calc.service';
import { PunchSource, PunchStatus, PunchType } from './attendance.enum';
import { cairoParts, distanceMeters } from './attendance-time.util';
import { EmployeeAppPunchDto } from './dto/employee-app.dto';

/** GPS readings less accurate than this are refused (metres) — env ATTENDANCE_MAX_ACCURACY_M. */
export const maxAccuracyM = (): number => Number(process.env.ATTENDANCE_MAX_ACCURACY_M) || 100;
/** A second tap within this many seconds is ignored. */
const DOUBLE_TAP_SECONDS = 60;

export interface BranchPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

@Injectable()
export class AttendancePunchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly calc: AttendanceCalcService,
  ) {}

  /** Branches the employee may check in at: their own, or every branch when they serve all. Only located ones. */
  async branchesFor(employeeId: string): Promise<{ all: { id: string; name: string; located: boolean }[]; points: BranchPoint[] }> {
    const own: { branch_id: string }[] = await this.dataSource.query('SELECT branch_id FROM employee_branches WHERE employee_id = ?', [employeeId]);
    const qb = this.dataSource.getRepository(Branch).createQueryBuilder('b').where('b.isActive = 1');
    if (own.length) qb.andWhere('b.id IN (:...ids)', { ids: own.map((r) => r.branch_id) });
    const rows = await qb.orderBy('b.name', 'ASC').getMany();
    const points = rows
      .filter((b) => b.latitude !== null && b.longitude !== null)
      .map((b) => ({ id: b.id, name: b.name, latitude: Number(b.latitude), longitude: Number(b.longitude), radius: Number(b.attendanceRadiusM) || 100 }));
    return { all: rows.map((b) => ({ id: b.id, name: b.name, located: points.some((p) => p.id === b.id) })), points };
  }

  /** What the next tap does today: check in, or check out of the open check-in. */
  async nextType(employeeId: string, workDate: string): Promise<PunchType> {
    const last = await this.dataSource.getRepository(AttendancePunch).findOne({
      where: { employeeId, workDate, status: PunchStatus.ACCEPTED },
      order: { punchedAt: 'DESC' },
    });
    return last?.punchType === PunchType.IN ? PunchType.OUT : PunchType.IN;
  }

  /**
   * A check-in / check-out from the employee app. The time is the server's; the
   * location must be inside the geofence of one of the employee's branches.
   * Refused attempts are stored (status «rejected») so HR can review them.
   */
  async punchFromApp(employee: Employee, dto: EmployeeAppPunchDto) {
    const now = new Date();
    const shift = await this.calc.shiftFor(employee.shiftId);
    const workDate = this.calc.workDateFor(shift, now);
    const repo = this.dataSource.getRepository(AttendancePunch);

    const recent = await repo
      .createQueryBuilder('p')
      .where('p.employeeId = :e', { e: employee.id })
      .andWhere('p.status = :s', { s: PunchStatus.ACCEPTED })
      .andWhere('p.punchedAt >= :t', { t: new Date(now.getTime() - DOUBLE_TAP_SECONDS * 1000) })
      .getCount();
    if (recent) throw new BadRequestException('تم تسجيل بصمتك منذ لحظات — انتظر دقيقة قبل المحاولة مرة أخرى');

    const punchType = await this.nextType(employee.id, workDate);
    const local = cairoParts(now);
    const base: Partial<AttendancePunch> = {
      employeeId: employee.id,
      punchType,
      punchedAt: now,
      workDate,
      localTime: local.time,
      source: PunchSource.MOBILE,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyM: dto.accuracy ?? null,
      shiftId: shift?.id ?? null,
      deviceInfo: dto.deviceInfo?.slice(0, 255) ?? null,
    };

    const reject = async (reason: string, near?: { b: BranchPoint; d: number }) => {
      await repo.save(
        repo.create({
          ...base,
          status: PunchStatus.REJECTED,
          rejectReason: reason,
          branchId: near?.b.id ?? null,
          branchName: near?.b.name ?? null,
          distanceM: near ? Math.round(near.d) : null,
        }),
      );
      throw new BadRequestException(reason);
    };

    const { points } = await this.branchesFor(employee.id);
    if (!points.length) return reject('لم يتم تحديد موقع فرعك على الخريطة بعد — تواصل مع الموارد البشرية');

    const measured = points
      .map((b) => ({ b, d: distanceMeters(dto.latitude, dto.longitude, b.latitude, b.longitude) }))
      .sort((x, y) => x.d - y.d);
    const nearest = measured[0];

    // The accepted GPS accuracy follows the branch radius HR sets (a 200 m radius
    // accepts readings up to ±200 m); ATTENDANCE_MAX_ACCURACY_M is only the floor.
    const max = Math.max(maxAccuracyM(), nearest.b.radius);
    if (dto.accuracy !== undefined && dto.accuracy > max) {
      return reject(`دقة الموقع ضعيفة (${Math.round(dto.accuracy)} م، المسموح ${Math.round(max)} م) — فعّل الـ GPS وحاول في مكان مفتوح`, nearest);
    }

    const inside = measured.find((m) => m.d <= m.b.radius);
    if (!inside) {
      return reject(`أنت خارج نطاق الفرع — أقرب فرع «${nearest.b.name}» على بُعد ${Math.round(nearest.d)} م`, nearest);
    }

    const saved = await repo.save(
      repo.create({
        ...base,
        status: PunchStatus.ACCEPTED,
        branchId: inside.b.id,
        branchName: inside.b.name,
        distanceM: Math.round(inside.d),
      }),
    );
    return saved;
  }
}
