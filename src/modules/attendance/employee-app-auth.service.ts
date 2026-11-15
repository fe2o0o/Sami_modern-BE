import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeAppChangePinDto, EmployeeAppLoginDto } from './dto/employee-app.dto';

const BAD_LOGIN = 'رقم الموبايل أو الرمز غير صحيح';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** Signed into employee-app tokens; ERP user tokens never carry it. */
export const EMPLOYEE_APP_TOKEN_TYPE = 'employee_app';

export interface EmployeeAppTokenPayload {
  sub: string;
  typ: typeof EMPLOYEE_APP_TOKEN_TYPE;
  /** PIN version — a PIN change invalidates older tokens. */
  pv: number;
}

/** Digits only, Arabic-Indic digits converted, +20 / 0020 → 0 (Egyptian numbers). */
export function normalizeMobile(v: string | null | undefined): string {
  if (!v) return '';
  let d = v
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return d;
}

/** «now» without milliseconds — what a DATETIME column stores back exactly. */
export const nowSeconds = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000);

export const pinVersion = (e: Pick<Employee, 'attendancePinChangedAt'>): number =>
  e.attendancePinChangedAt ? new Date(e.attendancePinChangedAt).getTime() : 0;

/**
 * Employee-app login (mobile + PIN). The token is signed with a key DERIVED from
 * the ERP secret, so it is useless on ERP routes and an ERP token is useless here.
 */
@Injectable()
export class EmployeeAppAuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  secret(): string {
    return `${this.config.get<string>('jwt.secret')}::employee-app`;
  }

  private sign(e: Employee): string {
    const payload: EmployeeAppTokenPayload = { sub: e.id, typ: EMPLOYEE_APP_TOKEN_TYPE, pv: pinVersion(e) };
    return this.jwt.sign(payload, {
      secret: this.secret(),
      expiresIn: (process.env.EMPLOYEE_APP_TOKEN_EXPIRES_IN ?? '30d') as never,
    });
  }

  /** Enabled, active employees whose mobile matches (PIN hash included). */
  private async findByMobile(mobile: string): Promise<Employee[]> {
    const n = normalizeMobile(mobile);
    if (n.length < 8) return [];
    const rows = await this.dataSource
      .getRepository(Employee)
      .createQueryBuilder('e')
      .addSelect('e.attendancePinHash')
      .where('e.attendanceEnabled = 1')
      .andWhere('e.isActive = 1')
      .andWhere('e.mobile IS NOT NULL')
      .andWhere('e.attendancePinHash IS NOT NULL')
      .getMany();
    return rows.filter((e) => normalizeMobile(e.mobile) === n);
  }

  async login(dto: EmployeeAppLoginDto) {
    const matches = await this.findByMobile(dto.mobile);
    if (matches.length !== 1) throw new UnauthorizedException(BAD_LOGIN);
    const e = matches[0];
    const repo = this.dataSource.getRepository(Employee);

    if (e.attendanceLockedUntil && new Date(e.attendanceLockedUntil).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(e.attendanceLockedUntil).getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(`تم إيقاف الدخول مؤقتاً بسبب محاولات خاطئة — حاول بعد ${mins} دقيقة أو تواصل مع الموارد البشرية`);
    }

    const ok = await bcrypt.compare(dto.pin, e.attendancePinHash ?? '');
    if (!ok) {
      const failed = (e.attendancePinFailedCount ?? 0) + 1;
      if (failed >= MAX_FAILED) {
        await repo.update(e.id, { attendancePinFailedCount: 0, attendanceLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) });
        throw new UnauthorizedException(`تم إيقاف الدخول ${LOCK_MINUTES} دقيقة بعد ${MAX_FAILED} محاولات خاطئة`);
      }
      await repo.update(e.id, { attendancePinFailedCount: failed });
      throw new UnauthorizedException(BAD_LOGIN);
    }

    if (e.attendancePinFailedCount || e.attendanceLockedUntil) {
      await repo.update(e.id, { attendancePinFailedCount: 0, attendanceLockedUntil: null });
    }
    return { accessToken: this.sign(e), employee: { id: e.id, code: e.code, name: e.name } };
  }

  async changePin(employeeId: string, dto: EmployeeAppChangePinDto) {
    if (dto.currentPin === dto.newPin) throw new BadRequestException('الرمز الجديد يطابق الحالي');
    const repo = this.dataSource.getRepository(Employee);
    const e = await repo.createQueryBuilder('e').addSelect('e.attendancePinHash').where('e.id = :id', { id: employeeId }).getOne();
    if (!e || !(await bcrypt.compare(dto.currentPin, e.attendancePinHash ?? ''))) throw new BadRequestException('الرمز الحالي غير صحيح');
    const changedAt = nowSeconds();
    await repo.update(e.id, { attendancePinHash: await bcrypt.hash(dto.newPin, 10), attendancePinChangedAt: changedAt });
    e.attendancePinChangedAt = changedAt;
    return { accessToken: this.sign(e) };
  }
}
