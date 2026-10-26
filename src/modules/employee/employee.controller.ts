import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import { EmployeeCommissionReportService } from './employee-commission-report.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CommissionReportQueryDto } from './dto/commission-report-query.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

const can = (user: AuthenticatedUser | undefined, key: string) => !!user?.isSuperAdmin || (user?.permissions ?? []).includes(key);

/** Salaries are only visible with «hr_salary.view». */
function hideSalary<T extends { netSalary?: number | null }>(row: T, user: AuthenticatedUser | undefined): T {
  return can(user, 'hr_salary.view') ? row : { ...row, netSalary: null };
}

@ApiTags('Employees')
@ApiBearerAuth('access-token')
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly commissionReport: EmployeeCommissionReportService,
  ) {}

  @Get('commissions-report')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'تقرير عمولات الموظفين من الفواتير المرحّلة' })
  commissionsReport(@Query() query: CommissionReportQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.commissionReport.generate(query, branchScope);
  }

  @Get('commissions-report/:employeeId')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'تفاصيل عمولات موظف: الفواتير والعمولة والنسبة لكل فاتورة' })
  commissionDetails(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: CommissionReportQueryDto,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.commissionReport.details(employeeId, query, branchScope);
  }

  @Post()
  @RequirePermissions('employees.create')
  @ResponseMessage('تم حفظ الموظف بنجاح')
  @ApiOperation({ summary: 'إضافة موظف' })
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthenticatedUser) {
    // only salary managers may set the starting salary
    if (!can(user, 'hr_salary.manage')) delete dto.netSalary;
    return this.employeeService.create(dto, user?.userId);
  }

  @Get()
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'عرض الموظفين مع الترقيم' })
  async findAll(@Query() query: EmployeeQueryDto, @BranchScope() branchScope: string[] | null, @CurrentUser() user: AuthenticatedUser) {
    const page = await this.employeeService.findAll(query, branchScope);
    return { ...page, items: page.items.map((e) => hideSalary(e, user)) };
  }

  @Get('summary')
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'تحليل الموظفين حسب نفس فلاتر القائمة (العمولات لمن يملك صلاحية التقارير)' })
  summary(@Query() query: EmployeeQueryDto, @CurrentUser() user: AuthenticatedUser, @BranchScope() branchScope: string[] | null) {
    return this.employeeService.summary(
      query,
      { withCommissions: can(user, 'accounting_reports.view'), withSalaries: can(user, 'hr_salary.view'), withDocuments: can(user, 'hr_documents.view') },
      branchScope,
    );
  }

  @Get(':id')
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'عرض موظف' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null, @CurrentUser() user: AuthenticatedUser) {
    return hideSalary(await this.employeeService.profile(id, branchScope), user);
  }

  @Put(':id')
  @RequirePermissions('employees.edit')
  @ResponseMessage('تم حفظ الموظف بنجاح')
  @ApiOperation({ summary: 'تعديل موظف' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeeService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('employees.delete')
  @ResponseMessage('تم حذف الموظف بنجاح')
  @ApiOperation({ summary: 'حذف موظف' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.remove(id);
  }

  @Patch(':id/restore')
  @RequirePermissions('employees.edit')
  @ResponseMessage('تم استعادة الموظف بنجاح')
  @ApiOperation({ summary: 'استعادة موظف محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.restore(id);
  }
}
