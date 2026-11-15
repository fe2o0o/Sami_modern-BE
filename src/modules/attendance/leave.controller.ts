import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { LeaveService } from './leave.service';
import { HrRequestService } from './hr-request.service';
import { LeaveRequestStatus } from './attendance.enum';
import {
  ApproveAdvanceRequestDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecisionDto,
  HrRequestUpdateDto,
  HrRequestsQueryDto,
  LeaveBalancesQueryDto,
  LeaveRequestsQueryDto,
  SetLeaveBalanceDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';

type Scope = string[] | null;

/** Leave (types, balances, requests) and employee → HR requests — the ERP side. */
@ApiTags('HR Leave & Requests')
@ApiBearerAuth('access-token')
@Controller('hr')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly requests: HrRequestService,
  ) {}

  // ── leave types ──
  @Get('leave-types')
  @RequirePermissions('leaves.view')
  types() {
    return this.leave.listTypes();
  }

  @Post('leave-types')
  @RequirePermissions('leaves.manage')
  @ResponseMessage('تم حفظ نوع الإجازة')
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(dto);
  }

  @Put('leave-types/:id')
  @RequirePermissions('leaves.manage')
  @ResponseMessage('تم حفظ نوع الإجازة')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.leave.updateType(id, dto);
  }

  @Delete('leave-types/:id')
  @RequirePermissions('leaves.manage')
  @ResponseMessage('تم حذف نوع الإجازة')
  removeType(@Param('id', ParseUUIDPipe) id: string) {
    return this.leave.removeType(id);
  }

  // ── balances ──
  @Get('leave-balances')
  @RequirePermissions('leaves.view')
  @ApiOperation({ summary: 'أرصدة الإجازات لكل موظف في سنة' })
  balances(@Query() q: LeaveBalancesQueryDto, @BranchScope() scope: Scope) {
    return this.leave.balancesReport(q, scope);
  }

  @Put('leave-balances')
  @RequirePermissions('leaves.manage')
  @ResponseMessage('تم حفظ رصيد الإجازة')
  setBalance(@Body() dto: SetLeaveBalanceDto, @BranchScope() scope: Scope) {
    return this.leave.setBalance(dto, scope);
  }

  // ── leave requests ──
  @Get('leave-requests')
  @RequirePermissions('leaves.view')
  list(@Query() q: LeaveRequestsQueryDto, @BranchScope() scope: Scope) {
    return this.leave.list(q, scope);
  }

  @Get('leave-requests/pending-count')
  @RequirePermissions('leaves.view')
  async pendingCount(@BranchScope() scope: Scope) {
    return { count: await this.leave.pendingCount(scope) };
  }

  @Post('leave-requests')
  @RequirePermissions('leaves.create')
  @ResponseMessage('تم تسجيل الإجازة')
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.leave.createByHr(dto, u, scope);
  }

  @Post('leave-requests/:id/approve')
  @HttpCode(200)
  @RequirePermissions('leaves.approve')
  @ResponseMessage('تم اعتماد الإجازة')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.leave.decide(id, LeaveRequestStatus.APPROVED, dto, u?.userId, scope);
  }

  @Post('leave-requests/:id/reject')
  @HttpCode(200)
  @RequirePermissions('leaves.approve')
  @ResponseMessage('تم رفض الإجازة')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.leave.decide(id, LeaveRequestStatus.REJECTED, dto, u?.userId, scope);
  }

  @Post('leave-requests/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('leaves.approve')
  @ResponseMessage('تم إلغاء الإجازة')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.leave.decide(id, LeaveRequestStatus.CANCELLED, dto, u?.userId, scope);
  }

  // ── HR requests ──
  @Get('requests')
  @RequirePermissions('hr_requests.view')
  hrRequests(@Query() q: HrRequestsQueryDto, @BranchScope() scope: Scope) {
    return this.requests.list(q, scope);
  }

  @Get('requests/open-count')
  @RequirePermissions('hr_requests.view')
  async openCount(@BranchScope() scope: Scope) {
    return { count: await this.requests.openCount(scope) };
  }

  @Put('requests/:id')
  @RequirePermissions('hr_requests.manage')
  @ResponseMessage('تم تحديث الطلب')
  updateRequest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrRequestUpdateDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.requests.update(id, dto, u?.userId, scope);
  }

  @Post('requests/:id/approve-advance')
  @HttpCode(200)
  @RequirePermissions('hr_requests.manage', 'advances.create', 'advances.approve')
  @ApiOperation({ summary: 'اعتماد طلب سلفة: ينشئ سلفة معتمدة تُصرف من صفحة السلف (بدون حركة نقدية)' })
  @ResponseMessage('تم اعتماد السلفة — تُصرف من صفحة السلف')
  approveAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveAdvanceRequestDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.requests.approveAdvance(id, dto, u?.userId, scope);
  }
}
