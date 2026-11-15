import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { AppFeature, appFeaturesOf } from './attendance.enum';
import { EMPLOYEE_APP_TOKEN_TYPE, EmployeeAppAuthService, EmployeeAppTokenPayload, pinVersion } from './employee-app-auth.service';

const EXPIRED = 'انتهت الجلسة — سجّل الدخول مرة أخرى';
const FEATURE_KEY = 'employeeAppFeature';

/** The «بوابة الموظف» section a route belongs to (HR grants sections per employee). */
export const RequireAppFeature = (feature: AppFeature) => SetMetadata(FEATURE_KEY, feature);

/**
 * Guards the employee-app routes (the controller is @Public() for the ERP guards).
 * Re-loads the employee on every call, so disabling attendance, deactivating the
 * employee or changing the PIN takes effect at once.
 */
@Injectable()
export class EmployeeAppGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: EmployeeAppAuthService,
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; employee?: Employee }>();
    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException(EXPIRED);

    let payload: EmployeeAppTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<EmployeeAppTokenPayload>(token, { secret: this.auth.secret() });
    } catch {
      throw new UnauthorizedException(EXPIRED);
    }
    if (payload?.typ !== EMPLOYEE_APP_TOKEN_TYPE || !payload.sub) throw new UnauthorizedException(EXPIRED);

    const e = await this.dataSource.getRepository(Employee).findOne({ where: { id: payload.sub } });
    if (!e || !e.isActive || !e.attendanceEnabled || pinVersion(e) !== payload.pv) throw new UnauthorizedException(EXPIRED);
    const feature = this.reflector.getAllAndOverride<AppFeature | undefined>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (feature && !appFeaturesOf(e).includes(feature)) throw new ForbiddenException('هذا القسم غير متاح لك — تواصل مع الموارد البشرية');
    req.employee = e;
    return true;
  }
}

/** The signed-in employee (employee-app routes only). */
export const CurrentEmployee = createParamDecorator((_d: unknown, ctx: ExecutionContext): Employee => {
  return ctx.switchToHttp().getRequest<{ employee: Employee }>().employee;
});
