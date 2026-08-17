import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { SalesReturnService } from './sales-return.service';
import { SalesReturnPostingService } from './sales-return-posting.service';
import { SalesReturnController } from './sales-return.controller';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { Product } from '../product/entities/product.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { User } from '../user/entities/user.entity';
import { StockModule } from '../stock/stock.module';
import { SequenceModule } from '../sequence/sequence.module';
import { CustomerModule } from '../customer/customer.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { CashSubledgerModule } from '../cash-subledger/cash-subledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesReturn,
      SalesReturnItem,
      SalesInvoice,
      SalesInvoiceItem,
      Product,
      Customer,
      Warehouse,
      Branch,
      FiscalYear,
      AccountingPeriod,
      AccountingSetting,
      User,
    ]),
    StockModule,
    SequenceModule,
    CustomerModule,
    JournalEntryModule,
    CashSubledgerModule,
  ],
  controllers: [SalesReturnController],
  providers: [SalesReturnService, SalesReturnPostingService],
  exports: [SalesReturnService],
})
export class SalesReturnModule {}
