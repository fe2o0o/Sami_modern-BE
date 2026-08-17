import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Warehouse, Branch])],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService, TypeOrmModule],
})
export class WarehouseModule {}
