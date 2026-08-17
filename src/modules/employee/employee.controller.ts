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
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Employees')
@ApiBearerAuth('access-token')
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly commissionReport: EmployeeCommissionReportService,
  ) {}

  @Get('commissions-report')
  @ApiOperation({ summary: 'تقرير عمولات الموظفين من الفواتير المرحّلة' })
  commissionsReport(@Query() query: CommissionReportQueryDto) {
    return this.commissionReport.generate(query);
  }

  @Post()
  @ResponseMessage('تم حفظ الموظف بنجاح')
  @ApiOperation({ summary: 'إضافة موظف' })
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeeService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض الموظفين مع الترقيم' })
  findAll(@Query() query: StatusQueryDto) {
    return this.employeeService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض موظف' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ الموظف بنجاح')
  @ApiOperation({ summary: 'تعديل موظف' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeeService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف الموظف بنجاح')
  @ApiOperation({ summary: 'حذف موظف' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة الموظف بنجاح')
  @ApiOperation({ summary: 'استعادة موظف محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.employeeService.restore(id);
  }
}
