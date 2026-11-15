import { CompanyService } from '../company/company.service';
import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Employee } from '../employee/entities/employee.entity';
import { CurrentEmployee, EmployeeAppGuard, RequireAppFeature } from './employee-app.guard';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { AttendancePunchService, maxAccuracyM } from './attendance-punch.service';
import { AttendanceCalcService } from './attendance-calc.service';
import { AttendanceService } from './attendance.service';
import { AppFeature, PunchStatus, appFeaturesOf } from './attendance.enum';
import { cairoParts, cairoToday } from './attendance-time.util';
import { EmployeeAppChangePinDto, EmployeeAppLoginDto, EmployeeAppMonthQueryDto, EmployeeAppPunchDto } from './dto/employee-app.dto';

/**
 * «بوابة الموظف» — sign-in, profile and attendance (separate Angular PWA). @Public() keeps the ERP user guards
 * off these routes; everything but login is guarded by EmployeeAppGuard.
 */
@ApiTags('Employee App')
@Public()
@Controller('employee-app')
export class EmployeeAppController {
  constructor(
    private readonly company: CompanyService,
    private readonly auth: EmployeeAppAuthService,
    private readonly punch: AttendancePunchService,
    private readonly calc: AttendanceCalcService,
    private readonly attendance: AttendanceService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  @ResponseMessage('تم تسجيل الدخول')
  login(@Body() dto: EmployeeAppLoginDto) {
    return this.auth.login(dto);
  }

  @Post('auth/change-pin')
  @HttpCode(200)
  @UseGuards(EmployeeAppGuard)
  @ApiBearerAuth('access-token')
  @ResponseMessage('تم تغيير الرمز')
  changePin(@CurrentEmployee() e: Employee, @Body() dto: EmployeeAppChangePinDto) {
    return this.auth.changePin(e.id, dto);
  }

  @Get('me')
  @UseGuards(EmployeeAppGuard)
  @ApiBearerAuth('access-token')
  async me(@CurrentEmployee() e: Employee) {
    const [shift, branches] = await Promise.all([this.calc.shiftFor(e.shiftId), this.punch.branchesFor(e.id)]);
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      jobTitle: e.jobTitle,
      mobile: e.mobile,
      shift: shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, weeklyOffDays: shift.weeklyOffDays } : null,
      branches: branches.all,
      maxAccuracyM: Math.max(maxAccuracyM(), ...branches.points.map((p) => p.radius)),
      /** Sections HR opened for this employee. */
      features: appFeaturesOf(e),
      company: await this.company
        .profile()
        .then((c) => ({ name: c.name, nameEn: c.nameEn, logo: c.logo, currency: c.currency }))
        .catch(() => null),
    };
  }

  @Get('today')
  @UseGuards(EmployeeAppGuard)
  @RequireAppFeature(AppFeature.ATTENDANCE)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'حالة اليوم + بصماته + الإجراء التالي' })
  async today(@CurrentEmployee() e: Employee) {
    const shift = await this.calc.shiftFor(e.shiftId);
    const workDate = this.calc.workDateFor(shift, new Date());
    const [punches, nextType, days] = await Promise.all([
      this.calc.dayPunches(e.id, workDate),
      this.punch.nextType(e.id, workDate),
      this.calc.computeDays([e], workDate, workDate),
    ]);
    return {
      workDate,
      today: cairoToday(),
      now: cairoParts().time,
      nextType,
      day: days.get(e.id)?.[0] ?? null,
      punches: punches.map((p) => ({ id: p.id, punchType: p.punchType, localTime: p.localTime, branchName: p.branchName, source: p.source })),
    };
  }

  @Post('punch')
  @HttpCode(200)
  @UseGuards(EmployeeAppGuard)
  @RequireAppFeature(AppFeature.ATTENDANCE)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'تسجيل حضور / انصراف بالموقع' })
  async doPunch(@CurrentEmployee() e: Employee, @Body() dto: EmployeeAppPunchDto) {
    const p = await this.punch.punchFromApp(e, dto);
    return {
      id: p.id,
      punchType: p.punchType,
      status: p.status === PunchStatus.ACCEPTED ? 'accepted' : p.status,
      workDate: p.workDate,
      localTime: p.localTime,
      branchName: p.branchName,
      distanceM: p.distanceM,
      message: p.punchType === 'in' ? `تم تسجيل الحضور ${p.localTime.slice(0, 5)}` : `تم تسجيل الانصراف ${p.localTime.slice(0, 5)}`,
    };
  }

  @Get('attendance')
  @UseGuards(EmployeeAppGuard)
  @RequireAppFeature(AppFeature.ATTENDANCE)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'حضوري في شهر' })
  month(@CurrentEmployee() e: Employee, @Query() q: EmployeeAppMonthQueryDto) {
    return this.attendance.monthOf(e, q.month ?? cairoToday().slice(0, 7));
  }
}
