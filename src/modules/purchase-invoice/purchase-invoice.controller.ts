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

@ApiTags('Purchase Invoices')
@ApiBearerAuth('access-token')
@Controller('purchases/invoices')
export class PurchaseInvoiceController {
  constructor(
    private readonly service: PurchaseInvoiceService,
    private readonly posting: PurchaseInvoicePostingService,
  ) {}

  @Get('products')
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiOperation({ summary: 'منتجات الشراء مع سعر التكلفة والمتاح في المخزن' })
  products(@Query('warehouseId') warehouseId?: string) {
    return this.service.purchaseProducts(warehouseId);
  }

  @Get()
  @ApiOperation({ summary: 'عرض فواتير المشتريات مع الترقيم والفلاتر' })
  findAll(@Query() query: PurchaseInvoiceQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض تفاصيل فاتورة مشتريات' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneDetailed(id);
  }

  @Post()
  @ResponseMessage('تم حفظ فاتورة المشتريات كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء فاتورة مشتريات (مسودة)' })
  create(
    @Body() dto: CreatePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'تعديل فاتورة مشتريات (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'حذف فاتورة مشتريات (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/post')
  @ResponseMessage('تم ترحيل فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'ترحيل فاتورة المشتريات (مخزون + مورّد + قيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.posting.post(id, actorId);
  }

  @Post(':id/reverse')
  @ResponseMessage('تم عكس فاتورة المشتريات بنجاح')
  @ApiOperation({ summary: 'عكس فاتورة مشتريات مُرحّلة' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePurchaseInvoiceDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.posting.reverse(id, dto, actorId);
  }
}
