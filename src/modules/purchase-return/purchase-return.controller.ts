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
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnPostingService } from './purchase-return-posting.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';
import { PurchaseReturnQueryDto } from './dto/purchase-return-query.dto';
import { ReversePurchaseReturnDto } from './dto/reverse-purchase-return.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Purchase Returns')
@ApiBearerAuth('access-token')
@Controller('purchases/returns')
export class PurchaseReturnController {
  constructor(
    private readonly service: PurchaseReturnService,
    private readonly posting: PurchaseReturnPostingService,
  ) {}

  @Get('returnable/:invoiceId')
  @RequirePermissions('purchase_returns.view')
  @ApiOperation({ summary: 'أصناف فاتورة مشتريات قابلة للإرجاع (المُشترى − المُرتجَع)' })
  returnable(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.service.returnableItems(invoiceId);
  }

  @Get()
  @RequirePermissions('purchase_returns.view')
  @ApiOperation({ summary: 'عرض مردودات المشتريات مع الترقيم والفلاتر' })
  findAll(@Query() query: PurchaseReturnQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('purchase_returns.view')
  @ApiOperation({ summary: 'تفاصيل مردود مشتريات' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('purchase_returns.create')
  @ResponseMessage('تم حفظ مردود المشتريات كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء مردود مشتريات (مسودة)' })
  create(
    @Body() dto: CreatePurchaseReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('purchase_returns.edit')
  @ResponseMessage('تم تحديث مردود المشتريات بنجاح')
  @ApiOperation({ summary: 'تعديل مردود مشتريات (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('purchase_returns.delete')
  @ResponseMessage('تم حذف مردود المشتريات بنجاح')
  @ApiOperation({ summary: 'حذف مردود مشتريات (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('purchase_returns.post')
  @ResponseMessage('تم ترحيل مردود المشتريات بنجاح')
  @ApiOperation({ summary: 'ترحيل المردود (مخزون + قيد + مورّد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('purchase_returns.reverse')
  @ResponseMessage('تم عكس مردود المشتريات بنجاح')
  @ApiOperation({ summary: 'عكس مردود مشتريات مُرحّل' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePurchaseReturnDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
