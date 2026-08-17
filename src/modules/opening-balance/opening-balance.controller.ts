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
import { OpeningBalanceService } from './opening-balance.service';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateOpeningBalanceDto } from './dto/update-opening-balance.dto';
import { ReverseOpeningBalanceDto } from './dto/reverse-opening-balance.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Opening Balances')
@ApiBearerAuth('access-token')
@Controller('opening-balances')
export class OpeningBalanceController {
  constructor(private readonly service: OpeningBalanceService) {}

  @Post()
  @ResponseMessage('تم حفظ الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'إنشاء رصيد افتتاحي (مسودة)' })
  create(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.create(dto, actorId);
  }

  @Get()
  @ApiQuery({ name: 'fiscalYearId', required: false })
  @ApiOperation({ summary: 'عرض الأرصدة الافتتاحية' })
  findAll(@Query('fiscalYearId') fiscalYearId?: string) {
    return this.service.findAll(fiscalYearId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض رصيد افتتاحي' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'تعديل رصيد افتتاحي (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpeningBalanceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Post(':id/validate')
  @ResponseMessage('تم التحقق من الرصيد الافتتاحي')
  @ApiOperation({ summary: 'التحقق من صحة الرصيد الافتتاحي قبل الترحيل' })
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.validate(id, actorId);
  }

  @Post(':id/post')
  @ResponseMessage('تم ترحيل الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'ترحيل الرصيد الافتتاحي (إنشاء القيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.post(id, actorId);
  }

  @Get(':id/journal-preview')
  @ApiOperation({ summary: 'معاينة القيد المحاسبي الناتج قبل الترحيل' })
  journalPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.journalPreview(id);
  }

  @Get(':id/journal-entry')
  @ApiOperation({ summary: 'عرض القيد المحاسبي المُرحّل' })
  journalEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.journalEntry(id);
  }

  @Post(':id/reversal-impact')
  @ApiOperation({ summary: 'تحليل أثر عكس الرصيد الافتتاحي قبل التنفيذ' })
  reversalImpact(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reversalImpact(id);
  }

  @Post(':id/reverse')
  @ResponseMessage('تم عكس الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'عكس الرصيد الافتتاحي (إنشاء قيد عكسي)' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseOpeningBalanceDto,
    @CurrentUser('userId') actorId: string,
    @CurrentUser('roleId') roleId: string,
  ) {
    return this.service.reverse(id, dto, actorId, roleId);
  }

  @Post(':id/copy-to-draft')
  @ResponseMessage('تم إنشاء نسخة تصحيح كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء نسخة تصحيح (مسودة) من رصيد معكوس' })
  copyToDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.copyToDraft(id, actorId);
  }
}
