import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { SupplierTransaction } from './entities/supplier-transaction.entity';
import { SupplierService } from './supplier.service';
import { SupplierLedgerService } from './supplier-ledger.service';
import { SupplierController } from './supplier.controller';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Supplier, SupplierTransaction]), CodeSettingModule],
  controllers: [SupplierController],
  providers: [SupplierService, SupplierLedgerService],
  exports: [SupplierService, SupplierLedgerService, TypeOrmModule],
})
export class SupplierModule {}
