import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpeningBalance } from './entities/opening-balance.entity';
import { OpeningBalanceDetail } from './entities/opening-balance-detail.entity';
import { OpeningBalanceService } from './opening-balance.service';
import { OpeningBalanceAccountingBuilder } from './opening-balance.accounting-builder';
import { OpeningBalanceController } from './opening-balance.controller';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Company } from '../company/entities/company.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Product } from '../product/entities/product.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Role } from '../role/entities/role.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { StockModule } from '../stock/stock.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BankAccountModule } from '../bank-account/bank-account.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OpeningBalance,
      OpeningBalanceDetail,
      FiscalYear,
      AccountingPeriod,
      ChartOfAccount,
      AccountingSetting,
      Company,
      Customer,
      Supplier,
      Product,
      Warehouse,
      Role,
      Treasury,
      BankAccount,
    ]),
    JournalEntryModule,
    StockModule,
    TreasuryModule,
    BankAccountModule,
  ],
  controllers: [OpeningBalanceController],
  providers: [OpeningBalanceService, OpeningBalanceAccountingBuilder],
  exports: [OpeningBalanceService, TypeOrmModule],
})
export class OpeningBalanceModule {}
