import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../branch/entities/branch.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Role } from '../role/entities/role.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Brand } from '../brand/entities/brand.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Employee } from '../employee/entities/employee.entity';
import { Product } from '../product/entities/product.entity';
import { LookupsService } from './lookups.service';
import { LookupsController } from './lookups.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Branch,
      Warehouse,
      Role,
      FiscalYear,
      ChartOfAccount,
      Unit,
      Brand,
      ProductCategory,
      Customer,
      Supplier,
      Employee,
      Product,
    ]),
  ],
  controllers: [LookupsController],
  providers: [LookupsService],
})
export class LookupsModule {}
