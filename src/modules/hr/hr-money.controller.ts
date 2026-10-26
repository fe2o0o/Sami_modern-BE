import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AdvanceService } from './advance.service';
import { CustodyService } from './custody.service';
import { EmployeeStatementService } from './employee-statement.service';
import {
  AdvanceQueryDto,
  CreateAdvanceDto,
  CreateCustodyDto,
  CustodyQueryDto,
  HrReasonDto,
  PayAdvanceDto,
  RepayAdvanceDto,
  SettleCustodyDto,
} from './dto/advance.dto';

/** Employee advances (سلف), custody (عُهد), employee statement and balances. */
@ApiTags('HR')
@ApiBearerAuth('access-token')
@Controller()
export class HrMoneyController {
  constructor(
    private readonly advances: AdvanceService,
    private readonly custody: CustodyService,
    private readonly statements: EmployeeStatementService,
  ) {}

  // ── advances ──
  @Get('hr/advances')
  @RequirePermissions('advances.view')
  listAdvances(@Query() q: AdvanceQueryDto, @BranchScope() scope: string[] | null) {
    return this.advances.list(q, scope);
  }

  @Get('hr/advances/summary')
  @RequirePermissions('advances.view')
  advancesSummary(@Query() q: AdvanceQueryDto, @BranchScope() scope: string[] | null) {
    return this.advances.summary(q, scope);
  }

  @Get('hr/advances/employee-context/:employeeId')
  @RequirePermissions('advances.view')
  @ApiOperation({ summary: 'صافي راتب الموظف وسلفه المفتوحة والحد الأقصى للسلفة' })
  advanceContext(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.advances.employeeContext(employeeId);
  }

  @Get('hr/advances/:id')
  @RequirePermissions('advances.view')
  getAdvance(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.advances.findOne(id, scope);
  }

  @Post('hr/advances')
  @RequirePermissions('advances.create')
  @ResponseMessage('تم حفظ طلب السلفة')
  createAdvance(@Body() dto: CreateAdvanceDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.create(dto, u?.userId, scope);
  }

  @Put('hr/advances/:id')
  @RequirePermissions('advances.edit')
  @ResponseMessage('تم حفظ طلب السلفة')
  updateAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAdvanceDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.update(id, dto, u?.userId, scope);
  }

  @Delete('hr/advances/:id')
  @RequirePermissions('advances.delete')
  @ResponseMessage('تم حذف طلب السلفة')
  removeAdvance(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.advances.remove(id, scope);
  }

  @Post('hr/advances/:id/approve')
  @RequirePermissions('advances.approve')
  @ResponseMessage('تم اعتماد السلفة')
  approveAdvance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.approve(id, u?.userId, scope);
  }

  @Post('hr/advances/:id/cancel')
  @RequirePermissions('advances.edit')
  @ResponseMessage('تم إلغاء السلفة')
  cancelAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrReasonDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.cancel(id, dto, u?.userId, scope);
  }

  @Post('hr/advances/:id/pay')
  @RequirePermissions('advances.post')
  @ResponseMessage('تم صرف السلفة')
  @ApiOperation({ summary: 'صرف السلفة المعتمدة من خزينة أو بنك (قيد + دفتر الخزينة)' })
  payAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayAdvanceDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.pay(id, dto, u?.userId, scope);
  }

  @Post('hr/advances/:id/reverse')
  @RequirePermissions('advances.reverse')
  @ResponseMessage('تم عكس صرف السلفة')
  reverseAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrReasonDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.reverse(id, dto, u?.userId, scope);
  }

  @Post('hr/advances/:id/repayments')
  @RequirePermissions('advances.post')
  @ResponseMessage('تم تسجيل السداد')
  repayAdvance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RepayAdvanceDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.advances.repay(id, dto, u?.userId, scope);
  }

  @Post('hr/advances/:id/repayments/:repaymentId/reverse')
  @RequirePermissions('advances.reverse')
  @ResponseMessage('تم عكس السداد')
  reverseRepayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repaymentId', ParseUUIDPipe) repaymentId: string,
    @Body() dto: HrReasonDto,
    @CurrentUser() u: AuthenticatedUser,
    @BranchScope() scope: string[] | null,
  ) {
    return this.advances.reverseRepayment(id, repaymentId, dto, u?.userId, scope);
  }

  // ── custody ──
  @Get('hr/custodies')
  @RequirePermissions('custody.view')
  listCustody(@Query() q: CustodyQueryDto, @BranchScope() scope: string[] | null) {
    return this.custody.list(q, scope);
  }

  @Get('hr/custodies/summary')
  @RequirePermissions('custody.view')
  custodySummary(@Query() q: CustodyQueryDto, @BranchScope() scope: string[] | null) {
    return this.custody.summary(q, scope);
  }

  @Get('hr/custodies/:id')
  @RequirePermissions('custody.view')
  getCustody(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.custody.findOne(id, scope);
  }

  @Post('hr/custodies')
  @RequirePermissions('custody.create')
  @ResponseMessage('تم حفظ العهدة')
  createCustody(@Body() dto: CreateCustodyDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.custody.create(dto, u?.userId, scope);
  }

  @Put('hr/custodies/:id')
  @RequirePermissions('custody.edit')
  @ResponseMessage('تم حفظ العهدة')
  updateCustody(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCustodyDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.custody.update(id, dto, u?.userId, scope);
  }

  @Delete('hr/custodies/:id')
  @RequirePermissions('custody.delete')
  @ResponseMessage('تم حذف العهدة')
  removeCustody(@Param('id', ParseUUIDPipe) id: string, @BranchScope() scope: string[] | null) {
    return this.custody.remove(id, scope);
  }

  @Post('hr/custodies/:id/post')
  @RequirePermissions('custody.post')
  @ResponseMessage('تم صرف العهدة')
  postCustody(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.custody.post(id, u?.userId, scope);
  }

  @Post('hr/custodies/:id/reverse')
  @RequirePermissions('custody.reverse')
  @ResponseMessage('تم عكس العهدة')
  reverseCustody(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrReasonDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.custody.reverse(id, dto, u?.userId, scope);
  }

  @Post('hr/custodies/:id/settlements')
  @RequirePermissions('custody.post')
  @ResponseMessage('تم تسجيل التسوية')
  settleCustody(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleCustodyDto, @CurrentUser() u: AuthenticatedUser, @BranchScope() scope: string[] | null) {
    return this.custody.settle(id, dto, u?.userId, scope);
  }

  @Post('hr/custodies/:id/settlements/:settlementId/reverse')
  @RequirePermissions('custody.reverse')
  @ResponseMessage('تم عكس التسوية')
  reverseSettlement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Body() dto: HrReasonDto,
    @CurrentUser() u: AuthenticatedUser,
    @BranchScope() scope: string[] | null,
  ) {
    return this.custody.reverseSettlement(id, settlementId, dto, u?.userId, scope);
  }

  // ── statement & balances ──
  @Get('employees/:id/statement')
  @RequirePermissions('advances.view')
  @ApiOperation({ summary: 'كشف حساب الموظف (السلف والعهد) من القيود المرحّلة' })
  statement(@Param('id', ParseUUIDPipe) id: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.statements.statement(id, { dateFrom, dateTo });
  }

  @Get('hr/employee-balances')
  @RequirePermissions('advances.view')
  @ApiOperation({ summary: 'أرصدة الموظفين (سلف وعهد) مع أقرب قسط مستحق' })
  employeeBalances(@Query('search') search: string | undefined, @Query('branchId') branchId: string | undefined, @BranchScope() scope: string[] | null) {
    return this.statements.balances({ search, branchId }, scope);
  }
}
