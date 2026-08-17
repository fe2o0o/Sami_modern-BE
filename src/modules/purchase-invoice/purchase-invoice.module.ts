import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoice } from './entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from './entities/purchase-invoice-item.entity';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoicePostingService } from './purchase-invoice-posting.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { Product } from '../product/entities/product.entity';
import { ProductImage } from '../product/entities/product-image.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { User } from '../user/entities/user.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { StockModule } from '../stock/stock.module';
import { SequenceModule } from '../sequence/sequence.module';
import { SupplierModule } from '../supplier/supplier.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { CashSubledgerModule } from '../cash-subledger/cash-subledger.module';

/**
 * Purchase Invoices. Posting/reversal reuse the shared engines — StockService,
 * SequenceService, SupplierLedgerService and the central JournalEntryService —
 * so all financial effects stay atomic and go through one accounting path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseInvoice,
      PurchaseInvoiceItem,
      Product,
      ProductImage,
      Unit,
      Supplier,
      Warehouse,
      Branch,
      FiscalYear,
      AccountingPeriod,
      User,
      WarehouseStock,
    ]),
    StockModule,
    SequenceModule,
    SupplierModule,
    JournalEntryModule,
    CashSubledgerModule,
  ],
  controllers: [PurchaseInvoiceController],
  providers: [PurchaseInvoiceService, PurchaseInvoicePostingService],
  exports: [PurchaseInvoiceService],
})
export class PurchaseInvoiceModule {}
