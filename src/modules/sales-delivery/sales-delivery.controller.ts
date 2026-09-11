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
import { SalesDeliveryService } from './sales-delivery.service';
import { SalesDeliveryPostingService } from './sales-delivery-posting.service';
import { CreateSalesDeliveryDto } from './dto/create-sales-delivery.dto';
import { UpdateSalesDeliveryDto } from './dto/update-sales-delivery.dto';
import { SalesDeliveryQueryDto } from './dto/sales-delivery-query.dto';
import { ReverseSalesDeliveryDto } from './dto/reverse-sales-delivery.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Sales Deliveries')
@ApiBearerAuth('access-token')
@Controller('sales/deliveries')
export class SalesDeliveryController {
  constructor(
    private readonly service: SalesDeliveryService,
    private readonly posting: SalesDeliveryPostingService,
  ) {}

  @Get('deliverable/:invoiceId')
  @RequirePermissions('sales_deliveries.view')
  @ApiOperation({ summary: 'أصناف فاتورة قابلة للتسليم (المطلوب − المُسلَّم)' })
  deliverable(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.service.deliverableItems(invoiceId);
  }

  @Get()
  @RequirePermissions('sales_deliveries.view')
  @ApiOperation({ summary: 'عرض أذون التسليم مع الترقيم والفلاتر' })
  findAll(@Query() query: SalesDeliveryQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('sales_deliveries.view')
  @ApiOperation({ summary: 'تفاصيل إذن تسليم' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('sales_deliveries.create')
  @ResponseMessage('تم حفظ إذن التسليم كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء إذن تسليم (مسودة)' })
  create(@Body() dto: CreateSalesDeliveryDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @RequirePermissions('sales_deliveries.edit')
  @ResponseMessage('تم تحديث إذن التسليم بنجاح')
  @ApiOperation({ summary: 'تعديل إذن تسليم (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesDeliveryDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('sales_deliveries.delete')
  @ResponseMessage('تم حذف إذن التسليم بنجاح')
  @ApiOperation({ summary: 'حذف إذن تسليم (مسودة فقط)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/post')
  @RequirePermissions('sales_deliveries.post')
  @ResponseMessage('تم ترحيل إذن التسليم بنجاح')
  @ApiOperation({ summary: 'ترحيل إذن التسليم (صرف مخزون + تكلفة مبيعات)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('sales_deliveries.reverse')
  @ResponseMessage('تم عكس إذن التسليم بنجاح')
  @ApiOperation({ summary: 'عكس إذن تسليم مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseSalesDeliveryDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
