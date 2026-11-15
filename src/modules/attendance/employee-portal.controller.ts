import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
import { AppFeature, HrRequestStatus, LeaveRequestStatus, RequestSource, appFeaturesOf } from './attendance.enum';
import { cairoToday } from './attendance-time.util';
import { AppListQueryDto, HrRequestBodyDto, LeavePreviewQueryDto, LeaveRequestBodyDto } from './dto/leave.dto';

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
}
