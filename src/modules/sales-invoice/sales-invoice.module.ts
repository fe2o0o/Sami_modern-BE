import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoiceItem } from './entities/sales-invoice-item.entity';
import { SalesInvoiceCommission } from './entities/sales-invoice-commission.entity';
import { Employee } from '../employee/entities/employee.entity';
import { SalesInvoiceService } from './sales-invoice.service';
import { SalesInvoicePostingService } from './sales-invoice-posting.service';
import { SalesInvoiceController } from './sales-invoice.controller';
import { Product } from '../product/entities/product.entity';
import { ProductImage } from '../product/entities/product-image.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { StockModule } from '../stock/stock.module';
import { SequenceModule } from '../sequence/sequence.module';
import { CustomerModule } from '../customer/customer.module';
import { ManufacturingModule } from '../manufacturing/manufacturing.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { CashSubledgerModule } from '../cash-subledger/cash-subledger.module';

/**
 * Sales Invoices. Posting/reversal reuse the shared engines — StockService,
 * SequenceService, CustomerLedgerService and the central JournalEntryService —
 * so all financial effects stay atomic and go through one accounting path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesInvoice,
      SalesInvoiceItem,
      SalesInvoiceCommission,
      Employee,
      Product,
      ProductImage,
      Unit,
      Customer,
      Warehouse,
      Branch,
      FiscalYear,
      AccountingPeriod,
      User,
      WarehouseStock,
    ]),
    StockModule,
    SequenceModule,
    CustomerModule,
    ManufacturingModule,
    JournalEntryModule,
    CashSubledgerModule,
  ],
  controllers: [SalesInvoiceController],
  providers: [SalesInvoiceService, SalesInvoicePostingService],
  exports: [SalesInvoiceService],
})
export class SalesInvoiceModule {}
