import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarehouseStock } from './entities/warehouse-stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WarehouseStock, StockMovement])],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService, TypeOrmModule],
})
export class StockModule {}
