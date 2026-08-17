import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnPostingService } from './purchase-return-posting.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { PurchaseInvoice } from '../purchase-invoice/entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../purchase-invoice/entities/purchase-invoice-item.entity';
import { Product } from '../product/entities/product.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { User } from '../user/entities/user.entity';
import { StockModule } from '../stock/stock.module';
import { SequenceModule } from '../sequence/sequence.module';
import { SupplierModule } from '../supplier/supplier.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { CashSubledgerModule } from '../cash-subledger/cash-subledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseReturn,
      PurchaseReturnItem,
      PurchaseInvoice,
      PurchaseInvoiceItem,
      Product,
      Supplier,
      Warehouse,
      Branch,
      FiscalYear,
      AccountingPeriod,
      AccountingSetting,
      User,
    ]),
    StockModule,
    SequenceModule,
    SupplierModule,
    JournalEntryModule,
    CashSubledgerModule,
  ],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService, PurchaseReturnPostingService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}
