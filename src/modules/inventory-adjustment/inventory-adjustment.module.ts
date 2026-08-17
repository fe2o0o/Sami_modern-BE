import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryAdjustmentPostingService } from './inventory-adjustment-posting.service';
import { InventoryAdjustmentController } from './inventory-adjustment.controller';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
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
      InventoryAdjustment,
      InventoryAdjustmentItem,
      Product,
      Unit,
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
  controllers: [InventoryAdjustmentController],
  providers: [InventoryAdjustmentService, InventoryAdjustmentPostingService],
  exports: [InventoryAdjustmentService],
})
export class InventoryAdjustmentModule {}
