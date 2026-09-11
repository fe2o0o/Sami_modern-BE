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
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Opening Balances')
@ApiBearerAuth('access-token')
@Controller('opening-balances')
export class OpeningBalanceController {
  constructor(private readonly service: OpeningBalanceService) {}

  @Post()
  @RequirePermissions('opening_balances.create')
  @ResponseMessage('تم حفظ الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'إنشاء رصيد افتتاحي (مسودة)' })
  create(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.create(dto, actorId);
  }

  @Get()
  @RequirePermissions('opening_balances.view')
  @ApiQuery({ name: 'fiscalYearId', required: false })
  @ApiOperation({ summary: 'عرض الأرصدة الافتتاحية' })
  findAll(@BranchScope() branchScope: string[] | null, @Query('fiscalYearId') fiscalYearId?: string) {
    return this.service.findAll(fiscalYearId, branchScope);
  }

  @Get(':id')
  @RequirePermissions('opening_balances.view')
  @ApiOperation({ summary: 'عرض رصيد افتتاحي' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOne(id, branchScope);
  }

  @Put(':id')
  @RequirePermissions('opening_balances.edit')
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
  @RequirePermissions('opening_balances.post')
  @ResponseMessage('تم التحقق من الرصيد الافتتاحي')
  @ApiOperation({ summary: 'التحقق من صحة الرصيد الافتتاحي قبل الترحيل' })
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.validate(id, actorId);
  }

  @Post(':id/post')
  @RequirePermissions('opening_balances.post')
  @ResponseMessage('تم ترحيل الرصيد الافتتاحي بنجاح')
  @ApiOperation({ summary: 'ترحيل الرصيد الافتتاحي (إنشاء القيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.post(id, actorId);
  }

  @Get(':id/journal-preview')
  @RequirePermissions('opening_balances.view')
  @ApiOperation({ summary: 'معاينة القيد المحاسبي الناتج قبل الترحيل' })
  journalPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.journalPreview(id);
  }

  @Get(':id/journal-entry')
  @RequirePermissions('opening_balances.view')
  @ApiOperation({ summary: 'عرض القيد المحاسبي المُرحّل' })
  journalEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.journalEntry(id);
  }

  @Post(':id/reversal-impact')
  @RequirePermissions('opening_balances.edit')
  @ApiOperation({ summary: 'تحليل أثر عكس الرصيد الافتتاحي قبل التنفيذ' })
  reversalImpact(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reversalImpact(id);
  }

  @Post(':id/reverse')
  @RequirePermissions('opening_balances.edit')
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
  @RequirePermissions('opening_balances.create')
  @ResponseMessage('تم إنشاء نسخة تصحيح كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء نسخة تصحيح (مسودة) من رصيد معكوس' })
  copyToDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.copyToDraft(id, actorId);
  }
}
