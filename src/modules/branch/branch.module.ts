import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from './entities/branch.entity';
import { Company } from '../company/entities/company.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { BranchService } from './branch.service';
import { BranchController } from './branch.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Branch,
      Company,
      Warehouse,
      WarehouseStock,
      StockMovement,
      SalesInvoice,
    ]),
  ],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService, TypeOrmModule],
})
export class BranchModule {}
