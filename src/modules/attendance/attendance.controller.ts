import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AttendanceService } from './attendance.service';
import {
  AttendanceEmployeesQueryDto,
  BranchLocationDto,
  CreateHolidayDto,
  CreateShiftDto,
  DailyBoardQueryDto,
  EmployeeAttendanceSetupDto,
  EmployeeMonthQueryDto,
  HolidayQueryDto,
  ManualPunchDto,
  MonthlyQueryDto,
  PunchQueryDto,
  UpdateShiftDto,
  VoidPunchDto,
} from './dto/attendance.dto';

type Scope = string[] | null;

/** HR attendance (الحضور والانصراف) — Phase 4, location based. Times are Egypt time. */
@ApiTags('HR Attendance')
@ApiBearerAuth('access-token')
@Controller('hr/attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get('settings')
  @RequirePermissions('attendance.view')
  settings() {
    return this.svc.settings();
  }

  // ── shifts ──
  @Get('shifts')
  @RequirePermissions('attendance.view')
  listShifts() {
    return this.svc.listShifts();
  }

  @Post('shifts')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حفظ الوردية')
  createShift(@Body() dto: CreateShiftDto) {
    return this.svc.createShift(dto);
  }

  @Put('shifts/:id')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حفظ الوردية')
  updateShift(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShiftDto) {
    return this.svc.updateShift(id, dto);
  }

  @Delete('shifts/:id')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حذف الوردية')
  removeShift(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeShift(id);
  }

  // ── holidays ──
  @Get('holidays')
  @RequirePermissions('attendance.view')
  listHolidays(@Query() q: HolidayQueryDto) {
    return this.svc.listHolidays(q);
  }

  @Post('holidays')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حفظ الإجازة')
  createHoliday(@Body() dto: CreateHolidayDto) {
    return this.svc.createHoliday(dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حذف الإجازة')
  removeHoliday(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeHoliday(id);
  }

  // ── branch locations ──
  @Get('branch-locations')
  @RequirePermissions('attendance.view')
  branchLocations(@BranchScope() scope: Scope) {
    return this.svc.branchLocations(scope);
  }

  @Put('branch-locations/:branchId')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حفظ موقع الفرع')
  setBranchLocation(@Param('branchId', ParseUUIDPipe) id: string, @Body() dto: BranchLocationDto, @BranchScope() scope: Scope) {
    return this.svc.setBranchLocation(id, dto, scope);
  }

  // ── employees ──
  @Get('employees')
  @RequirePermissions('attendance.view')
  employees(@Query() q: AttendanceEmployeesQueryDto, @BranchScope() scope: Scope) {
    return this.svc.employees(q, scope);
  }

  @Get('employees/:id')
  @RequirePermissions('attendance.view')
  employeeSetup(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: Scope) {
    return this.svc.employeeSetup(id, scope);
  }

  @Put('employees/:id')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم حفظ إعدادات حضور الموظف')
  updateEmployeeSetup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EmployeeAttendanceSetupDto, @BranchScope() scope: Scope) {
    return this.svc.updateEmployeeSetup(id, dto, scope);
  }

  @Get('employees/:id/month')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'حضور الموظف يوماً بيوم في شهر' })
  employeeMonth(@Param('id', ParseUUIDPipe) id: string, @Query() q: EmployeeMonthQueryDto, @BranchScope() scope: Scope) {
    return this.svc.employeeMonth(id, q.month, scope);
  }

  // ── punches ──
  @Get('punches')
  @RequirePermissions('attendance.view')
  punches(@Query() q: PunchQueryDto, @BranchScope() scope: Scope) {
    return this.svc.punches(q, scope);
  }

  @Post('punches')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم تسجيل البصمة يدوياً')
  addManualPunch(@Body() dto: ManualPunchDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.svc.addManualPunch(dto, u?.userId, scope);
  }

  @Post('punches/:id/void')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم إلغاء البصمة')
  voidPunch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPunchDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.svc.voidPunch(id, dto, u?.userId, scope);
  }

  @Post('punches/:id/approve')
  @RequirePermissions('attendance.manage')
  @ResponseMessage('تم اعتماد البصمة')
  approvePunch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPunchDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.svc.approvePunch(id, dto, u?.userId, scope);
  }

  // ── reports ──
  @Get('daily')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'لوحة الحضور اليومي' })
  daily(@Query() q: DailyBoardQueryDto, @BranchScope() scope: Scope) {
    return this.svc.daily(q, scope);
  }

  @Get('monthly')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'ملخص الحضور الشهري' })
  monthly(@Query() q: MonthlyQueryDto, @BranchScope() scope: Scope) {
    return this.svc.monthly(q, scope);
  }
}
