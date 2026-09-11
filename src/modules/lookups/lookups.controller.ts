import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LookupsService } from './lookups.service';

@ApiTags('Lookups')
@ApiBearerAuth('access-token')
@Controller('lookups')
export class LookupsController {
  constructor(private readonly lookupsService: LookupsService) {}

  @Get('roles')
  @ApiOperation({ summary: 'قائمة الأدوار' })
  roles() {
    return this.lookupsService.roles();
  }

  @Get('branches')
  @ApiOperation({ summary: 'قائمة الفروع' })
  branches() {
    return this.lookupsService.branches();
  }

  @Get('fiscal-years')
  @ApiOperation({ summary: 'قائمة السنوات المالية' })
  fiscalYears() {
    return this.lookupsService.fiscalYears();
  }

  @Get('posting-accounts')
  @ApiOperation({ summary: 'قائمة الحسابات القابلة للترحيل (النشطة فقط)' })
  postingAccounts() {
    return this.lookupsService.postingAccounts();
  }

  @Get('cash-accounts')
  @ApiOperation({ summary: 'حسابات النقدية (لربط الخزائن)' })
  cashAccounts() {
    return this.lookupsService.cashAccounts();
  }

  @Get('bank-accounts')
  @ApiOperation({ summary: 'حسابات البنوك (لربط الحسابات البنكية)' })
  bankAccounts() {
    return this.lookupsService.bankAccounts();
  }

  @Get('units')
  @ApiOperation({ summary: 'قائمة وحدات القياس' })
  units() {
    return this.lookupsService.units();
  }

  @Get('brands')
  @ApiOperation({ summary: 'قائمة العلامات التجارية' })
  brands() {
    return this.lookupsService.brands();
  }

  @Get('product-categories')
  @ApiOperation({ summary: 'قائمة تصنيفات المنتجات' })
  productCategories() {
    return this.lookupsService.productCategories();
  }

  @Get('products')
  @ApiOperation({ summary: 'قائمة المنتجات' })
  products() {
    return this.lookupsService.products();
  }

  @Get('customers')
  @ApiOperation({ summary: 'قائمة العملاء' })
  customers() {
    return this.lookupsService.customers();
  }

  @Get('suppliers')
  @ApiOperation({ summary: 'قائمة الموردين' })
  suppliers() {
    return this.lookupsService.suppliers();
  }

  @Get('employees')
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'قائمة الموظفين مع نسبة العمولة (اختياريًا حسب الفرع)' })
  employees(@Query('branchId') branchId?: string) {
    return this.lookupsService.employees(branchId);
  }

  @Get('warehouses')
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'قائمة المخازن (اختياريًا حسب الفرع)' })
  warehouses(@Query('branchId') branchId?: string) {
    return this.lookupsService.warehouses(branchId);
  }

  @Get('warehouse-types')
  @ApiOperation({ summary: 'قائمة أنواع المخازن' })
  warehouseTypes() {
    return this.lookupsService.warehouseTypes();
  }
}
