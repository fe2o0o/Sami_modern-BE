import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PermissionService } from './permission.service';
import { LeaveRequestStatus } from './attendance.enum';
import { DecisionDto } from './dto/leave.dto';
import { CreatePermissionDto, PermissionSettingsDto, PermissionsQueryDto } from './dto/permission.dto';

type Scope = string[] | null;

/** «الأذونات» (mission / personal) — the ERP side. */
@ApiTags('HR Permissions')
@ApiBearerAuth('access-token')
@Controller('hr/permissions')
export class PermissionController {
  constructor(private readonly permissions: PermissionService) {}

  @Get()
  @RequirePermissions('work_permissions.view')
  list(@Query() q: PermissionsQueryDto, @BranchScope() scope: Scope) {
    return this.permissions.list(q, scope);
  }

  @Get('pending-count')
  @RequirePermissions('work_permissions.view')
  async pendingCount(@BranchScope() scope: Scope) {
    return { count: await this.permissions.pendingCount(scope) };
  }

  @Get('settings')
  @RequirePermissions('work_permissions.view')
  settings() {
    return this.permissions.settings();
  }

  @Put('settings')
  @RequirePermissions('work_permissions.manage')
  @ResponseMessage('تم حفظ إعدادات الأذونات')
  saveSettings(@Body() dto: PermissionSettingsDto) {
    return this.permissions.saveSettings(dto);
  }

  @Get('balance/:employeeId')
  @RequirePermissions('work_permissions.view')
  @ApiOperation({ summary: 'رصيد الأذونات الشخصية لموظف في شهر' })
  balance(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query('month') month?: string) {
    return this.permissions.balance(employeeId, /^\d{4}-\d{2}$/.test(month ?? '') ? month! : new Date().toISOString().slice(0, 7));
  }

  @Post()
  @RequirePermissions('work_permissions.create')
  @ResponseMessage('تم تسجيل الإذن')
  create(@Body() dto: CreatePermissionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.permissions.createByHr(dto, u, scope);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('work_permissions.approve')
  @ResponseMessage('تم اعتماد الإذن')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.permissions.decide(id, LeaveRequestStatus.APPROVED, dto, u?.userId, scope);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('work_permissions.approve')
  @ResponseMessage('تم رفض الإذن')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.permissions.decide(id, LeaveRequestStatus.REJECTED, dto, u?.userId, scope);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('work_permissions.approve')
  @ResponseMessage('تم إلغاء الإذن')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: Scope) {
    return this.permissions.decide(id, LeaveRequestStatus.CANCELLED, dto, u?.userId, scope);
  }
}
