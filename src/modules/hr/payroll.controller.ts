import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { PayrollService } from './payroll.service';
import { CreatePayrollRunDto, PayPayrollDto, PayrollQueryDto, UpdatePayrollLineDto } from './dto/payroll.dto';
import { HrReasonDto } from './dto/advance.dto';

/** Monthly payroll (مسير الرواتب) — one run per branch per month. */
@ApiTags('HR')
@ApiBearerAuth('access-token')
@Controller('hr/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @RequirePermissions('payroll.view')
  list(@Query() q: PayrollQueryDto, @BranchScope() scope: string[] | null) {
    return this.payroll.list(q, scope);
  }

  @Get('unassigned/:branchId')
  @RequirePermissions('payroll.view')
  @ApiOperation({ summary: 'موظفون يخدمون الفرع بدون «فرع صرف الراتب»' })
  unassigned(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.payroll.unassignedEmployees(branchId);
  }

  @Get(':id')
  @RequirePermissions('payroll.view')
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.payroll.findOne(id, scope);
  }

  @Post()
  @RequirePermissions('payroll.create')
  @ResponseMessage('تم إنشاء المسير وحساب رواتب الموظفين')
  create(@Body() dto: CreatePayrollRunDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.payroll.create(dto, u?.userId, scope);
  }

  @Post(':id/recalculate')
  @RequirePermissions('payroll.create')
  @ResponseMessage('تم تحديث المسير من البيانات الحالية')
  recalculate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.payroll.recalculate(id, u?.userId, scope);
  }

  @Put(':id/lines/:lineId')
  @RequirePermissions('payroll.create')
  @ResponseMessage('تم تعديل راتب الموظف')
  updateLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: UpdatePayrollLineDto,
    @CurrentUser() u: AuthenticatedUser,
    @BranchScope() scope: string[] | null,
  ) {
    return this.payroll.updateLine(id, lineId, dto, u?.userId, scope);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions('payroll.create')
  @ResponseMessage('تم استبعاد الموظف من المسير')
  removeLine(@Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @BranchScope() scope: string[] | null) {
    return this.payroll.removeLine(id, lineId, scope);
  }

  @Delete(':id')
  @RequirePermissions('payroll.delete')
  @ResponseMessage('تم حذف مسودة المسير')
  remove(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.payroll.remove(id, scope);
  }

  @Post(':id/approve')
  @RequirePermissions('payroll.approve')
  @ResponseMessage('تم اعتماد المسير وترحيل قيد الرواتب')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.payroll.approve(id, u?.userId, scope);
  }

  @Post(':id/reverse')
  @RequirePermissions('payroll.reverse')
  @ResponseMessage('تم عكس المسير')
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrReasonDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.payroll.reverse(id, dto, u?.userId, scope);
  }

  @Post(':id/pay')
  @RequirePermissions('payroll.pay')
  @ResponseMessage('تم صرف الرواتب')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayPayrollDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.payroll.pay(id, dto, u?.userId, scope);
  }

  @Post(':id/payments/:paymentId/reverse')
  @RequirePermissions('payroll.pay')
  @ResponseMessage('تم عكس عملية الصرف')
  reversePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: HrReasonDto,
    @CurrentUser() u: AuthenticatedUser,
    @BranchScope() scope: string[] | null,
  ) {
    return this.payroll.reversePayment(id, paymentId, dto, u?.userId, scope);
  }
}
