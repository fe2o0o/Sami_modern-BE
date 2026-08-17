import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccountingPeriodService } from './accounting-period.service';
import { UpdateAccountingPeriodDto } from './dto/update-accounting-period.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Accounting Periods')
@ApiBearerAuth('access-token')
@Controller('accounting-periods')
export class AccountingPeriodController {
  constructor(private readonly periodService: AccountingPeriodService) {}

  @Get()
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiOperation({ summary: 'عرض الفترات المحاسبية لسنة مالية' })
  findAll(@Query('fiscalYearId', ParseUUIDPipe) fiscalYearId: string) {
    return this.periodService.findByFiscalYear(fiscalYearId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض فترة محاسبية' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.periodService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم تعديل الفترة المحاسبية بنجاح')
  @ApiOperation({ summary: 'تعديل فترة محاسبية (المفتوحة فقط)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountingPeriodDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.periodService.update(id, dto, actorId);
  }

  @Post(':id/close')
  @ResponseMessage('تم إغلاق الفترة المحاسبية بنجاح')
  @ApiOperation({ summary: 'إغلاق الفترة المحاسبية' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.periodService.close(id, actorId);
  }

  @Post(':id/reopen')
  @ResponseMessage('تم إعادة فتح الفترة المحاسبية بنجاح')
  @ApiOperation({ summary: 'إعادة فتح الفترة المحاسبية' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.periodService.reopen(id, actorId);
  }
}
