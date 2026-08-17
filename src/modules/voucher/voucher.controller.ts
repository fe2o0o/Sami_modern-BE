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

@ApiTags('Vouchers')
@ApiBearerAuth('access-token')
@Controller('vouchers')
export class VoucherController {
  constructor(
    private readonly service: VoucherService,
    private readonly posting: VoucherPostingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'عرض سندات القبض والصرف مع الترقيم والفلاتر' })
  findAll(@Query() query: VoucherQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل سند' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneDetailed(id);
  }

  @Post()
  @ResponseMessage('تم حفظ السند كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء سند قبض/صرف (مسودة)' })
  create(@Body() dto: CreateVoucherDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث السند بنجاح')
  @ApiOperation({ summary: 'تعديل سند (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoucherDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف السند بنجاح')
  @ApiOperation({ summary: 'حذف سند (مسودة فقط)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/post')
  @ResponseMessage('تم ترحيل السند بنجاح')
  @ApiOperation({ summary: 'ترحيل السند (قيد + حساب الطرف + الخزينة/البنك)' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.posting.post(id, actorId);
  }

  @Post(':id/reverse')
  @ResponseMessage('تم عكس السند بنجاح')
  @ApiOperation({ summary: 'عكس سند مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseVoucherDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.posting.reverse(id, dto, actorId);
  }
}
