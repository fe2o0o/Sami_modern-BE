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
import { JournalEntryService } from './journal-entry.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { JournalEntryQueryDto } from './dto/journal-entry-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Journal Entries')
@ApiBearerAuth('access-token')
@Controller('journal-entries')
export class JournalEntryController {
  constructor(private readonly service: JournalEntryService) {}

  @Get()
  @RequirePermissions('journal_entries.view')
  @ApiOperation({ summary: 'عرض القيود اليومية مع الترقيم والفلاتر' })
  findAll(@Query() query: JournalEntryQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('journal_entries.view')
  @ApiOperation({ summary: 'عرض تفاصيل قيد يومية' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('journal_entries.create')
  @ResponseMessage('تم حفظ القيد كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء قيد يدوي (مسودة)' })
  create(
    @Body() dto: CreateJournalEntryDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.createManual(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('journal_entries.edit')
  @ResponseMessage('تم تحديث القيد بنجاح')
  @ApiOperation({ summary: 'تعديل قيد يدوي (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJournalEntryDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.updateManual(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('journal_entries.delete')
  @ResponseMessage('تم حذف القيد بنجاح')
  @ApiOperation({ summary: 'حذف قيد يدوي (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('journal_entries.post')
  @ResponseMessage('تم ترحيل القيد بنجاح')
  @ApiOperation({ summary: 'ترحيل قيد يدوي' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('journal_entries.reverse')
  @ResponseMessage('تم عكس القيد بنجاح')
  @ApiOperation({ summary: 'عكس قيد يدوي مُرحّل (إنشاء قيد عكسي)' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.reverse(id, dto, actorId, branchScope);
  }

  @Post(':id/copy')
  @RequirePermissions('journal_entries.create')
  @ResponseMessage('تم إنشاء نسخة كمسودة بنجاح')
  @ApiOperation({ summary: 'نسخ قيد يدوي كمسودة جديدة' })
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.copy(id, actorId);
  }
}
