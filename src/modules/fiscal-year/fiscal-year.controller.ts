import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FiscalYearService } from './fiscal-year.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { UpdateFiscalYearDto } from './dto/update-fiscal-year.dto';
import { QueryFiscalYearDto } from './dto/query-fiscal-year.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Fiscal Years')
@ApiBearerAuth('access-token')
@Controller('fiscal-years')
export class FiscalYearController {
  constructor(private readonly fiscalYearService: FiscalYearService) {}

  @Post()
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم إنشاء السنة المالية بنجاح')
  @ApiOperation({ summary: 'إضافة سنة مالية' })
  create(@Body() dto: CreateFiscalYearDto, @CurrentUser('userId') actorId: string) {
    return this.fiscalYearService.create(dto, actorId);
  }

  @Get()
  @RequirePermissions('fiscal_years.view')
  @ApiOperation({ summary: 'عرض السنوات المالية مع الترقيم' })
  findAll(@Query() query: QueryFiscalYearDto) {
    return this.fiscalYearService.findAll(query);
  }

  // NOTE: must be declared before ':id' so "current" is not treated as an id.
  @Get('current')
  @RequirePermissions('fiscal_years.view')
  @ApiOperation({ summary: 'السنة المالية الحالية' })
  findCurrent() {
    return this.fiscalYearService.findCurrent();
  }

  @Get(':id')
  @RequirePermissions('fiscal_years.view')
  @ApiOperation({ summary: 'عرض سنة مالية' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYearService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم تعديل السنة المالية بنجاح')
  @ApiOperation({ summary: 'تعديل سنة مالية (المفتوحة فقط)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFiscalYearDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.fiscalYearService.update(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم حذف السنة المالية بنجاح')
  @ApiOperation({ summary: 'حذف سنة مالية (غير مستخدمة)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.fiscalYearService.remove(id, actorId);
  }

  @Post(':id/generate-periods')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم إنشاء الفترات المحاسبية بنجاح')
  @ApiOperation({ summary: 'إنشاء الفترات المحاسبية للسنة المالية' })
  generatePeriods(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.fiscalYearService.generatePeriods(id, actorId);
  }

  @Post(':id/set-current')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم تعيين السنة المالية الحالية بنجاح')
  @ApiOperation({ summary: 'تعيين السنة المالية الحالية' })
  setCurrent(@Param('id', ParseUUIDPipe) id: string) {
    return this.fiscalYearService.setCurrent(id);
  }

  @Post(':id/close')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم إقفال السنة المالية بنجاح')
  @ApiOperation({ summary: 'إقفال السنة المالية' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.fiscalYearService.close(id, actorId);
  }

  @Post(':id/reopen')
  @RequirePermissions('fiscal_years.manage')
  @ResponseMessage('تم إعادة فتح السنة المالية بنجاح')
  @ApiOperation({ summary: 'إعادة فتح السنة المالية (مدير النظام)' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('roleId') roleId: string,
  ) {
    return this.fiscalYearService.reopen(id, roleId);
  }
}
