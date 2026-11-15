import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Employee } from '../employee/entities/employee.entity';
import { CurrentEmployee, EmployeeAppGuard, RequireAppFeature } from './employee-app.guard';
import { AttendanceCalcService } from './attendance-calc.service';
import { AttendancePunchService } from './attendance-punch.service';
import { LeaveService } from './leave.service';
import { HrRequestService } from './hr-request.service';
import { PortalService } from './portal.service';
import { MySalesService } from './my-sales.service';
import { PermissionService } from './permission.service';
import { PermissionBodyDto, PermissionPreviewQueryDto } from './dto/permission.dto';
import { AppFeature, HrRequestStatus, LeaveRequestStatus, RequestSource, appFeaturesOf } from './attendance.enum';
import { cairoToday } from './attendance-time.util';
import { AppListQueryDto, MySalesQueryDto, HrRequestBodyDto, LeavePreviewQueryDto, LeaveRequestBodyDto } from './dto/leave.dto';

/** «بوابة الموظف» — home summary, leave, HR requests, product catalog, customer balances. */
@ApiTags('Employee App')
@ApiBearerAuth('access-token')
@Public()
@UseGuards(EmployeeAppGuard)
@Controller('employee-app')
export class EmployeePortalController {
  constructor(
    private readonly calc: AttendanceCalcService,
    private readonly punch: AttendancePunchService,
    private readonly leave: LeaveService,
    private readonly requests: HrRequestService,
    private readonly portal: PortalService,
    private readonly sales: MySalesService,
    private readonly permissions: PermissionService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('home')
  @ApiOperation({ summary: 'ملخص الرئيسية: حالة اليوم، الطلبات المفتوحة، رصيد الإجازات' })
  async home(@CurrentEmployee() e: Employee) {
    const features = appFeaturesOf(e);
    const out: Record<string, unknown> = { features, today: cairoToday() };
    if (features.includes(AppFeature.ATTENDANCE)) {
      const shift = await this.calc.shiftFor(e.shiftId);
      const workDate = this.calc.workDateFor(shift, new Date());
      const [nextType, days] = await Promise.all([this.punch.nextType(e.id, workDate), this.calc.computeDays([e], workDate, workDate)]);
      out['attendance'] = { workDate, nextType, day: days.get(e.id)?.[0] ?? null };
    }
    if (features.includes(AppFeature.LEAVE)) {
      const year = Number(cairoToday().slice(0, 4));
      const [balances, mine] = await Promise.all([this.leave.balancesFor([e.id], year), this.leave.mine(e.id)]);
      const perm = await this.permissions.mine(e.id);
      out['permissions'] = { pending: perm.items.filter((x) => x.status === LeaveRequestStatus.PENDING).length, balance: perm.balance };
      out['leave'] = {
        balances: (balances.get(e.id) ?? []).filter((b) => b.hasBalance),
        pending: mine.filter((l) => l.status === LeaveRequestStatus.PENDING).length,
        upcoming: mine.filter((l) => l.status === LeaveRequestStatus.APPROVED && l.toDate >= cairoToday()).slice(0, 3),
      };
    }
    if (features.includes(AppFeature.REQUESTS)) {
      const mine = await this.requests.mine(e.id);
      out['requests'] = { open: mine.filter((r) => r.status === HrRequestStatus.NEW || r.status === HrRequestStatus.IN_PROGRESS).length };
    }
    if (features.includes(AppFeature.SALES)) {
      out['sales'] = await this.sales.monthCard(e);
    }
    return out;
  }

  // ── leave ──
  @Get('leave')
  @RequireAppFeature(AppFeature.LEAVE)
  @ApiOperation({ summary: 'أنواع الإجازات ورصيدي وطلباتي' })
  async myLeave(@CurrentEmployee() e: Employee) {
    const year = Number(cairoToday().slice(0, 4));
    const [balances, requests] = await Promise.all([this.leave.balancesFor([e.id], year), this.leave.mine(e.id)]);
    return { year, balances: balances.get(e.id) ?? [], requests };
  }

  @Get('leave/preview')
  @RequireAppFeature(AppFeature.LEAVE)
  preview(@CurrentEmployee() e: Employee, @Query() q: LeavePreviewQueryDto) {
    return this.leave.preview(e, q);
  }

  @Post('leave')
  @RequireAppFeature(AppFeature.LEAVE)
  @ResponseMessage('تم إرسال طلب الإجازة')
  requestLeave(@CurrentEmployee() e: Employee, @Body() dto: LeaveRequestBodyDto) {
    return this.leave.create(e, dto, RequestSource.APP, null);
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @RequireAppFeature(AppFeature.LEAVE)
  @ResponseMessage('تم سحب الطلب')
  cancelLeave(@CurrentEmployee() e: Employee, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.cancelMine(e.id, id);
  }

  // ── permissions (مأمورية / شخصي) — part of the leave section ──
  @Get('permissions')
  @RequireAppFeature(AppFeature.LEAVE)
  @ApiOperation({ summary: 'أذوناتي ورصيد الإذن الشخصي هذا الشهر' })
  myPermissions(@CurrentEmployee() e: Employee) {
    return this.permissions.mine(e.id);
  }

  @Get('permissions/preview')
  @RequireAppFeature(AppFeature.LEAVE)
  previewPermission(@CurrentEmployee() e: Employee, @Query() q: PermissionPreviewQueryDto) {
    return this.permissions.preview(e, q);
  }

  @Post('permissions')
  @RequireAppFeature(AppFeature.LEAVE)
  @ResponseMessage('تم إرسال طلب الإذن')
  requestPermission(@CurrentEmployee() e: Employee, @Body() dto: PermissionBodyDto) {
    return this.permissions.create(e, dto, RequestSource.APP, null);
  }

  @Post('permissions/:id/cancel')
  @HttpCode(200)
  @RequireAppFeature(AppFeature.LEAVE)
  @ResponseMessage('تم سحب الطلب')
  cancelPermission(@CurrentEmployee() e: Employee, @Param('id', ParseUUIDPipe) id: string) {
    return this.permissions.cancelMine(e.id, id);
  }

  // ── HR requests ──
  @Get('requests')
  @RequireAppFeature(AppFeature.REQUESTS)
  myRequests(@CurrentEmployee() e: Employee) {
    return this.requests.mine(e.id);
  }

  @Post('requests')
  @RequireAppFeature(AppFeature.REQUESTS)
  @ResponseMessage('تم إرسال الطلب للموارد البشرية')
  createRequest(@CurrentEmployee() e: Employee, @Body() dto: HrRequestBodyDto) {
    return this.requests.create(e.id, dto);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequireAppFeature(AppFeature.REQUESTS)
  @ResponseMessage('تم سحب الطلب')
  cancelRequest(@CurrentEmployee() e: Employee, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancelMine(e.id, id);
  }

  // ── catalog ──
  @Get('categories')
  @RequireAppFeature(AppFeature.PRODUCTS)
  categories() {
    return this.portal.categories();
  }

  @Get('products')
  @RequireAppFeature(AppFeature.PRODUCTS)
  products(@CurrentEmployee() e: Employee, @Query() q: AppListQueryDto) {
    return this.portal.products(e, q);
  }

  @Get('products/:id')
  @RequireAppFeature(AppFeature.PRODUCTS)
  product(@CurrentEmployee() e: Employee, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.product(e, id);
  }

  // ── customers ──
  @Get('customers')
  @RequireAppFeature(AppFeature.CUSTOMERS)
  customers(@CurrentEmployee() e: Employee, @Query() q: AppListQueryDto) {
    return this.portal.customers(e, q);
  }

  @Get('customers/:id')
  @RequireAppFeature(AppFeature.CUSTOMERS)
  customer(@CurrentEmployee() e: Employee, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.customer(e, id);
  }

  // ── «مبيعاتي» ──
  @Get('sales')
  @RequireAppFeature(AppFeature.SALES)
  @ApiOperation({ summary: 'مبيعاتي: الفواتير والعملاء والمنتجات وحالة التسليم (بدون عمولات)' })
  async mySales(@CurrentEmployee() e: Employee, @Query() q: MySalesQueryDto) {
    if (!q.employeeId || q.employeeId === e.id) return this.sales.mySales(e, q.from, q.to);
    if (!appFeaturesOf(e).includes(AppFeature.SALES_ALL)) throw new ForbiddenException('عرض مبيعات الموظفين الآخرين غير متاح لك');
    const other = await this.dataSource.getRepository(Employee).findOne({ where: { id: q.employeeId }, withDeleted: true });
    if (!other) throw new NotFoundException('الموظف غير موجود');
    return this.sales.mySales(other, q.from, q.to, await this.portal.branchIdsOf(e.id));
  }

  @Get('sales/team')
  @RequireAppFeature(AppFeature.SALES_ALL)
  @ApiOperation({ summary: 'مبيعات كل الموظفين (في فروعي) — بدون عمولات' })
  async salesTeam(@CurrentEmployee() e: Employee, @Query() q: MySalesQueryDto) {
    return this.sales.team(q.from, q.to, await this.portal.branchIdsOf(e.id));
  }
}
