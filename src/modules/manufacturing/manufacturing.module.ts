import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManufacturingOrder } from './entities/manufacturing-order.entity';
import { ManufacturingOrderComponent } from './entities/manufacturing-order-component.entity';
import { ManufacturingService } from './manufacturing.service';
import { ManufacturingProductionService } from './manufacturing-production.service';
import { ManufacturingController } from './manufacturing.controller';
import { Product } from '../product/entities/product.entity';
import { ProductComponent } from '../product/entities/product-component.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { User } from '../user/entities/user.entity';
import { SequenceModule } from '../sequence/sequence.module';
import { StockModule } from '../stock/stock.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { SupplierModule } from '../supplier/supplier.module';

/**
 * Manufacturing (production) orders — documentary made-to-order requests with
 * customer specifications and a status workflow. No stock/accounting effect.
 * Exports its service so Sales Invoice posting can create linked orders from
 * invoice lines flagged as "manufacturing".
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManufacturingOrder,
      ManufacturingOrderComponent,
      Product,
      ProductComponent,
      Customer,
      Branch,
      FiscalYear,
      User,
    ]),
    SequenceModule,
    StockModule,
    JournalEntryModule,
    SupplierModule,
  ],
  controllers: [ManufacturingController],
  providers: [ManufacturingService, ManufacturingProductionService],
  exports: [ManufacturingService],
})
export class ManufacturingModule {}
