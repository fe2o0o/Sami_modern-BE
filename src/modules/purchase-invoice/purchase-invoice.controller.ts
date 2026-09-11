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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoicePostingService } from './purchase-invoice-posting.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { UpdatePurchaseInvoiceDto } from './dto/update-purchase-invoice.dto';
import { ReversePurchaseInvoiceDto } from './dto/reverse-purchase-invoice.dto';
import { PurchaseInvoiceQueryDto } from './dto/purchase-invoice-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Purchase Invoices')
@ApiBearerAuth('access-token')
@Controller('purchases/invoices')
export class PurchaseInvoiceController {
  constructor(
    private readonly service: PurchaseInvoiceService,
    private readonly posting: PurchaseInvoicePostingService,
  ) {}

  @Get('products')
  @RequirePermissions('purchase_invoices.view')
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiOperation({ summary: 'منتجات الشراء مع سعر التكلفة والمتاح في المخزن' })
  products(@Query('warehouseId') warehouseId?: string) {
    return this.service.purchaseProducts(warehouseId);
  }

  @Get()
  @RequirePermissions('purchase_invoices.view')
  @ApiOperation({ summary: 'عرض فواتير المشتريات مع الترقيم والفلاتر' })
  findAll(@Query() query: PurchaseInvoiceQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('purchase_invoices.view')
  @ApiOperation({ summary: 'عرض تفاصيل فاتورة مشتريات' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('purchase_invoices.create')
  @ResponseMessage('تم حفظ فاتورة المشتريات كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء فاتورة مشتريات (مسودة)' })
  create(
    @Body() dto: CreatePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('purchase_invoices.edit')
  @ResponseMessage('تم تحديث فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'تعديل فاتورة مشتريات (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('purchase_invoices.delete')
  @ResponseMessage('تم حذف فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'حذف فاتورة مشتريات (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('purchase_invoices.post')
  @ResponseMessage('تم ترحيل فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'ترحيل فاتورة المشتريات (مخزون + مورّد + قيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('purchase_invoices.reverse')
  @ResponseMessage('تم عكس فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'عكس فاتورة مشتريات مُرحّلة' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
