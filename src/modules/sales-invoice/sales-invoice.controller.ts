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
import { SalesInvoiceService } from './sales-invoice.service';
import { SalesInvoicePostingService } from './sales-invoice-posting.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';
import { ReverseSalesInvoiceDto } from './dto/reverse-sales-invoice.dto';
import { SalesInvoiceQueryDto } from './dto/sales-invoice-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Sales Invoices')
@ApiBearerAuth('access-token')
@Controller('sales/invoices')
export class SalesInvoiceController {
  constructor(
    private readonly service: SalesInvoiceService,
    private readonly posting: SalesInvoicePostingService,
  ) {}

  @Get('products')
  @RequirePermissions('sales_invoices.view')
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiOperation({ summary: 'منتجات البيع مع السعر والمتاح في المخزن' })
  products(@Query('warehouseId') warehouseId?: string) {
    return this.service.saleProducts(warehouseId);
  }

  @Get()
  @RequirePermissions('sales_invoices.view')
  @ApiOperation({ summary: 'عرض فواتير المبيعات مع الترقيم والفلاتر' })
  findAll(@Query() query: SalesInvoiceQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('sales_invoices.view')
  @ApiOperation({ summary: 'عرض تفاصيل فاتورة مبيعات' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('sales_invoices.create')
  @ResponseMessage('تم حفظ فاتورة المبيعات كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء فاتورة مبيعات (مسودة)' })
  create(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('sales_invoices.edit')
  @ResponseMessage('تم تحديث فاتورة المبيعات بنجاح')
  @ApiOperation({ summary: 'تعديل فاتورة مبيعات (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('sales_invoices.delete')
  @ResponseMessage('تم حذف فاتورة المبيعات بنجاح')
  @ApiOperation({ summary: 'حذف فاتورة مبيعات (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('sales_invoices.post')
  @ResponseMessage('تم ترحيل فاتورة المبيعات بنجاح')
  @ApiOperation({ summary: 'ترحيل فاتورة المبيعات (مخزون + عميل + قيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('sales_invoices.reverse')
  @ResponseMessage('تم عكس فاتورة المبيعات بنجاح')
  @ApiOperation({ summary: 'عكس فاتورة مبيعات مُرحّلة' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseSalesInvoiceDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
