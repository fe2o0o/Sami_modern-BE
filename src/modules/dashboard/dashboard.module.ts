import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { SalesReturn } from '../sales-return/entities/sales-return.entity';
import { PurchaseInvoice } from '../purchase-invoice/entities/purchase-invoice.entity';
import { PurchaseInvoiceItem } from '../purchase-invoice/entities/purchase-invoice-item.entity';
import { PurchaseReturn } from '../purchase-return/entities/purchase-return.entity';
import { CustomerTransaction } from '../customer/entities/customer-transaction.entity';
import { SupplierTransaction } from '../supplier/entities/supplier-transaction.entity';
import { TreasuryTransaction } from '../treasury/entities/treasury-transaction.entity';
import { BankTransaction } from '../bank-account/entities/bank-transaction.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { ManufacturingOrder } from '../manufacturing/entities/manufacturing-order.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesInvoice,
      SalesInvoiceItem,
      SalesReturn,
      PurchaseInvoice,
      PurchaseInvoiceItem,
      PurchaseReturn,
      CustomerTransaction,
      SupplierTransaction,
      TreasuryTransaction,
      BankTransaction,
      WarehouseStock,
      ManufacturingOrder,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
