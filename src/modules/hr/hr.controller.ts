import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { DepartmentService, JobGradeService } from './hr-lookup.service';
import { SalaryService } from './salary.service';
import { CreateDepartmentDto, CreateJobGradeDto, UpdateDepartmentDto, UpdateJobGradeDto } from './dto/hr-lookup.dto';
import { CreatePayComponentDto, UpdatePayComponentDto } from './dto/salary.dto';

/** HR managed lists: departments, job grades, pay components + the salary-structure report. */
@ApiTags('HR')
@ApiBearerAuth('access-token')
@Controller('hr')
export class HrController {
  constructor(
    private readonly departments: DepartmentService,
    private readonly grades: JobGradeService,
    private readonly salary: SalaryService,
  ) {}

  // ── departments ──
  @Get('departments')
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'الأقسام' })
  listDepartments(@Query() q: StatusQueryDto) {
    return this.departments.findAll(q);
  }

  @Post('departments')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حفظ القسم بنجاح')
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.departments.create(dto);
  }

  @Put('departments/:id')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حفظ القسم بنجاح')
  updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departments.update(id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حذف القسم بنجاح')
  removeDepartment(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.remove(id);
  }

  // ── job grades ──
  @Get('job-grades')
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'الدرجات الوظيفية' })
  listGrades(@Query() q: StatusQueryDto) {
    return this.grades.findAll(q);
  }

  @Get('job-grades/tree')
  @RequirePermissions('hr.view')
  @ApiOperation({ summary: 'الهيكل التنظيمي: شجرة الدرجات الوظيفية بموظفيها' })
  gradesTree() {
    return this.grades.tree();
  }

  @Post('job-grades')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حفظ الدرجة الوظيفية بنجاح')
  createGrade(@Body() dto: CreateJobGradeDto) {
    return this.grades.create(dto);
  }

  @Put('job-grades/:id')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حفظ الدرجة الوظيفية بنجاح')
  updateGrade(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobGradeDto) {
    return this.grades.update(id, dto);
  }

  @Delete('job-grades/:id')
  @RequirePermissions('hr.manage')
  @ResponseMessage('تم حذف الدرجة الوظيفية بنجاح')
  removeGrade(@Param('id', ParseUUIDPipe) id: string) {
    return this.grades.remove(id);
  }

  // ── pay components ──
  @Get('pay-components')
  @RequirePermissions('hr_salary.view')
  @ApiOperation({ summary: 'بنود الراتب' })
  listComponents() {
    return this.salary.listComponents();
  }

  @Post('pay-components')
  @RequirePermissions('hr_salary.manage')
  @ResponseMessage('تم حفظ بند الراتب بنجاح')
  createComponent(@Body() dto: CreatePayComponentDto) {
    return this.salary.createComponent(dto);
  }

  @Put('pay-components/:id')
  @RequirePermissions('hr_salary.manage')
  @ResponseMessage('تم حفظ بند الراتب بنجاح')
  updateComponent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayComponentDto) {
    return this.salary.updateComponent(id, dto);
  }

  @Delete('pay-components/:id')
  @RequirePermissions('hr_salary.manage')
  @ResponseMessage('تم حذف بند الراتب بنجاح')
  removeComponent(@Param('id', ParseUUIDPipe) id: string) {
    return this.salary.removeComponent(id);
  }

  // ── salary structure report ──
  @Get('salary-structure')
  @RequirePermissions('hr_salary.view')
  @ApiOperation({ summary: 'هيكل الرواتب الحالي لكل الموظفين' })
  salaryStructure(
    @Query('search') search: string | undefined,
    @Query('branchId') branchId: string | undefined,
    @Query('departmentId') departmentId: string | undefined,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.salary.structure({ search, branchId, departmentId, branchScope });
  }
}
