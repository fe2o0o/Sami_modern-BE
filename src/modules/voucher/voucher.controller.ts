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
import { VoucherService } from './voucher.service';
import { VoucherPostingService } from './voucher-posting.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';
import { ReverseVoucherDto } from './dto/reverse-voucher.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Vouchers')
@ApiBearerAuth('access-token')
@Controller('vouchers')
export class VoucherController {
  constructor(
    private readonly service: VoucherService,
    private readonly posting: VoucherPostingService,
  ) {}

  @Get()
  @RequirePermissions('vouchers.view')
  @ApiOperation({ summary: 'عرض سندات القبض والصرف مع الترقيم والفلاتر' })
  findAll(@Query() query: VoucherQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('vouchers.view')
  @ApiOperation({ summary: 'تفاصيل سند' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('vouchers.create')
  @ResponseMessage('تم حفظ السند كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء سند قبض/صرف (مسودة)' })
  create(
    @Body() dto: CreateVoucherDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('vouchers.edit')
  @ResponseMessage('تم تحديث السند بنجاح')
  @ApiOperation({ summary: 'تعديل سند (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoucherDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('vouchers.delete')
  @ResponseMessage('تم حذف السند بنجاح')
  @ApiOperation({ summary: 'حذف سند (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('vouchers.post')
  @ResponseMessage('تم ترحيل السند بنجاح')
  @ApiOperation({ summary: 'ترحيل السند (قيد + حساب الطرف + الخزينة/البنك)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('vouchers.reverse')
  @ResponseMessage('تم عكس السند بنجاح')
  @ApiOperation({ summary: 'عكس سند مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseVoucherDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
