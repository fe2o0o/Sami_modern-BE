import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { CustomerTransaction } from './entities/customer-transaction.entity';
import { CustomerService } from './customer.service';
import { CustomerLedgerService } from './customer-ledger.service';
import { CustomerController } from './customer.controller';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, CustomerTransaction]), CodeSettingModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerLedgerService],
  exports: [CustomerService, CustomerLedgerService, TypeOrmModule],
})
export class CustomerModule {}
