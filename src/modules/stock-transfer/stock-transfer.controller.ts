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
import { StockTransferService } from './stock-transfer.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import { StockTransferQueryDto } from './dto/stock-transfer-query.dto';
import { ReverseStockTransferDto } from './dto/reverse-stock-transfer.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Stock Transfers')
@ApiBearerAuth('access-token')
@Controller('inventory/transfers')
export class StockTransferController {
  constructor(private readonly service: StockTransferService) {}

  @Get()
  @ApiOperation({ summary: 'عرض التحويلات المخزنية مع الترقيم والفلاتر' })
  findAll(@Query() query: StockTransferQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل تحويل مخزني' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneDetailed(id);
  }

  @Post()
  @ResponseMessage('تم حفظ التحويل كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء تحويل مخزني (مسودة)' })
  create(@Body() dto: CreateStockTransferDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث التحويل بنجاح')
  @ApiOperation({ summary: 'تعديل تحويل (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockTransferDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف التحويل بنجاح')
  @ApiOperation({ summary: 'حذف تحويل (مسودة فقط)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/post')
  @ResponseMessage('تم ترحيل التحويل بنجاح')
  @ApiOperation({ summary: 'ترحيل التحويل (نقل الرصيد)' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.post(id, actorId);
  }

  @Post(':id/reverse')
  @ResponseMessage('تم عكس التحويل بنجاح')
  @ApiOperation({ summary: 'عكس تحويل مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseStockTransferDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.reverse(id, dto, actorId);
  }
}
