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
import { ChartOfAccountService } from './chart-of-account.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { QueryChartOfAccountDto } from './dto/query-chart-of-account.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Chart of Accounts')
@ApiBearerAuth('access-token')
@Controller('chart-of-accounts')
export class ChartOfAccountController {
  constructor(private readonly accountService: ChartOfAccountService) {}

  @Post()
  @ResponseMessage('تم إنشاء الحساب بنجاح')
  @ApiOperation({ summary: 'إضافة حساب' })
  create(
    @Body() dto: CreateChartOfAccountDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.accountService.create(dto, actorId);
  }

  @Get()
  @ApiOperation({ summary: 'عرض الحسابات (قائمة مسطحة مع الترقيم)' })
  findAll(@Query() query: QueryChartOfAccountDto) {
    return this.accountService.findAll(query);
  }

  // NOTE: static routes must precede ':id'.
  @Get('tree')
  @ApiOperation({ summary: 'عرض شجرة الحسابات' })
  tree(@Query() query: QueryChartOfAccountDto) {
    return this.accountService.tree(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'ملخص إحصائيات شجرة الحسابات' })
  summary() {
    return this.accountService.summary();
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض حساب' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountService.findOne(id);
  }

  @Get(':id/children')
  @ApiOperation({ summary: 'عرض الحسابات الفرعية المباشرة' })
  findChildren(@Param('id', ParseUUIDPipe) id: string) {
    return this.accountService.findChildren(id);
  }

  @Put(':id')
  @ResponseMessage('تم تعديل الحساب بنجاح')
  @ApiOperation({ summary: 'تعديل حساب' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChartOfAccountDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.accountService.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف الحساب بنجاح')
  @ApiOperation({ summary: 'حذف حساب' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.accountService.remove(id, actorId);
  }

  @Patch(':id/toggle-active')
  @ResponseMessage('تم تحديث حالة الحساب')
  @ApiOperation({ summary: 'تفعيل / تعطيل الحساب' })
  toggleActive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.accountService.toggleActive(id, actorId);
  }
}
