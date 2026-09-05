import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { configurations, validateEnv } from './config';
import { LoggerModule } from './core/logger/logger.module';
import { DatabaseModule } from './database/database.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RoleModule } from './modules/role/role.module';
import { UserModule } from './modules/user/user.module';
import { CompanyModule } from './modules/company/company.module';
import { BranchModule } from './modules/branch/branch.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { TreasuryModule } from './modules/treasury/treasury.module';
import { BankAccountModule } from './modules/bank-account/bank-account.module';
import { FiscalYearModule } from './modules/fiscal-year/fiscal-year.module';
import { AccountingPeriodModule } from './modules/accounting-period/accounting-period.module';
import { ChartOfAccountModule } from './modules/chart-of-account/chart-of-account.module';
import { AccountingSettingModule } from './modules/accounting-setting/accounting-setting.module';
import { JournalEntryModule } from './modules/journal-entry/journal-entry.module';
import { AccountingReportModule } from './modules/accounting-report/accounting-report.module';
import { OpeningBalanceModule } from './modules/opening-balance/opening-balance.module';
import { SalesInvoiceModule } from './modules/sales-invoice/sales-invoice.module';
import { PurchaseInvoiceModule } from './modules/purchase-invoice/purchase-invoice.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { InventoryAdjustmentModule } from './modules/inventory-adjustment/inventory-adjustment.module';
import { StockTransferModule } from './modules/stock-transfer/stock-transfer.module';
import { SalesReturnModule } from './modules/sales-return/sales-return.module';
import { SalesDeliveryModule } from './modules/sales-delivery/sales-delivery.module';
import { CodeSettingModule } from './modules/code-setting/code-setting.module';
import { PurchaseReturnModule } from './modules/purchase-return/purchase-return.module';
import { UnitModule } from './modules/unit/unit.module';
import { BrandModule } from './modules/brand/brand.module';
import { ProductCategoryModule } from './modules/product-category/product-category.module';
import { ProductModule } from './modules/product/product.module';
import { CustomerModule } from './modules/customer/customer.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { StockModule } from './modules/stock/stock.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { ExcelModule } from './common/excel/excel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurations,
      validate: validateEnv,
    }),
    LoggerModule,
    DatabaseModule,
    PermissionsModule,
    RoleModule,
    UserModule,
    AuthModule,
    CompanyModule,
    BranchModule,
    WarehouseModule,
    TreasuryModule,
    BankAccountModule,
    FiscalYearModule,
    AccountingPeriodModule,
    ChartOfAccountModule,
    AccountingSettingModule,
    JournalEntryModule,
    AccountingReportModule,
    OpeningBalanceModule,
    SalesInvoiceModule,
    PurchaseInvoiceModule,
    ManufacturingModule,
    VoucherModule,
    EmployeeModule,
    InventoryAdjustmentModule,
    StockTransferModule,
    SalesReturnModule,
    SalesDeliveryModule,
    CodeSettingModule,
    PurchaseReturnModule,
    UnitModule,
    BrandModule,
    ProductCategoryModule,
    ProductModule,
    CustomerModule,
    SupplierModule,
    StockModule,
    LookupsModule,
    ExcelModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
