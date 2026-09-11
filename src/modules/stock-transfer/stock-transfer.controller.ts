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
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Stock Transfers')
@ApiBearerAuth('access-token')
@Controller('inventory/transfers')
export class StockTransferController {
  constructor(private readonly service: StockTransferService) {}

  @Get()
  @RequirePermissions('stock_transfers.view')
  @ApiOperation({ summary: 'عرض التحويلات المخزنية مع الترقيم والفلاتر' })
  findAll(@Query() query: StockTransferQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('stock_transfers.view')
  @ApiOperation({ summary: 'تفاصيل تحويل مخزني' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('stock_transfers.create')
  @ResponseMessage('تم حفظ التحويل كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء تحويل مخزني (مسودة)' })
  create(
    @Body() dto: CreateStockTransferDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('stock_transfers.edit')
  @ResponseMessage('تم تحديث التحويل بنجاح')
  @ApiOperation({ summary: 'تعديل تحويل (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockTransferDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('stock_transfers.delete')
  @ResponseMessage('تم حذف التحويل بنجاح')
  @ApiOperation({ summary: 'حذف تحويل (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('stock_transfers.post')
  @ResponseMessage('تم ترحيل التحويل بنجاح')
  @ApiOperation({ summary: 'ترحيل التحويل (نقل الرصيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('stock_transfers.reverse')
  @ResponseMessage('تم عكس التحويل بنجاح')
  @ApiOperation({ summary: 'عكس تحويل مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseStockTransferDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.reverse(id, dto, actorId, branchScope);
  }
}
