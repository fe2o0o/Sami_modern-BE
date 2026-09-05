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
import { SalesReturnService } from './sales-return.service';
import { SalesReturnPostingService } from './sales-return-posting.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { SalesReturnQueryDto } from './dto/sales-return-query.dto';
import { ReverseSalesReturnDto } from './dto/reverse-sales-return.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Sales Returns')
@ApiBearerAuth('access-token')
@Controller('sales/returns')
export class SalesReturnController {
  constructor(
    private readonly service: SalesReturnService,
    private readonly posting: SalesReturnPostingService,
  ) {}

  @Get('returnable/:invoiceId')
  @RequirePermissions('sales_returns.view')
  @ApiOperation({ summary: 'أصناف فاتورة قابلة للإرجاع (المُباع − المُرتجَع)' })
  returnable(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.service.returnableItems(invoiceId);
  }

  @Get()
  @RequirePermissions('sales_returns.view')
  @ApiOperation({ summary: 'عرض مردودات المبيعات مع الترقيم والفلاتر' })
  findAll(@Query() query: SalesReturnQueryDto, @BranchScope() branchScope: string | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('sales_returns.view')
  @ApiOperation({ summary: 'تفاصيل مردود مبيعات' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('sales_returns.create')
  @ResponseMessage('تم حفظ مردود المبيعات كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء مردود مبيعات (مسودة)' })
  create(
    @Body() dto: CreateSalesReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('sales_returns.edit')
  @ResponseMessage('تم تحديث مردود المبيعات بنجاح')
  @ApiOperation({ summary: 'تعديل مردود مبيعات (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('sales_returns.delete')
  @ResponseMessage('تم حذف مردود المبيعات بنجاح')
  @ApiOperation({ summary: 'حذف مردود مبيعات (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('sales_returns.post')
  @ResponseMessage('تم ترحيل مردود المبيعات بنجاح')
  @ApiOperation({ summary: 'ترحيل المردود (مخزون + قيد + عميل)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('sales_returns.reverse')
  @ResponseMessage('تم عكس مردود المبيعات بنجاح')
  @ApiOperation({ summary: 'عكس مردود مبيعات مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseSalesReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
