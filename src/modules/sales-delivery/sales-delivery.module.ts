import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesDelivery } from './entities/sales-delivery.entity';
import { SalesDeliveryItem } from './entities/sales-delivery-item.entity';
import { SalesDeliveryService } from './sales-delivery.service';
import { SalesDeliveryPostingService } from './sales-delivery-posting.service';
import { SalesDeliveryController } from './sales-delivery.controller';
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
import { JournalEntryModule } from '../journal-entry/journal-entry.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesDelivery,
      SalesDeliveryItem,
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
    JournalEntryModule,
  ],
  controllers: [SalesDeliveryController],
  providers: [SalesDeliveryService, SalesDeliveryPostingService],
  exports: [SalesDeliveryService],
})
export class SalesDeliveryModule {}
