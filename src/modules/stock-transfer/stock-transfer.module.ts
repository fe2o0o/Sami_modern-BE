import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StockTransfer } from './entities/stock-transfer.entity';
import { StockTransferItem } from './entities/stock-transfer-item.entity';
import { StockTransferService } from './stock-transfer.service';
import { StockTransferController } from './stock-transfer.controller';
import { Product } from '../product/entities/product.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { User } from '../user/entities/user.entity';
import { StockModule } from '../stock/stock.module';
import { SequenceModule } from '../sequence/sequence.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StockTransfer, StockTransferItem, Product, Unit, Warehouse, FiscalYear, User]),
    StockModule,
    SequenceModule,
  ],
  controllers: [StockTransferController],
  providers: [StockTransferService],
  exports: [StockTransferService],
})
export class StockTransferModule {}
