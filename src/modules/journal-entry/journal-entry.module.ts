import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { JournalEntryService } from './journal-entry.service';
import { JournalEntrySubledgerService } from './journal-entry-subledger.service';
import { JournalEntryController } from './journal-entry.controller';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { SequenceModule } from '../sequence/sequence.module';
import { CustomerModule } from '../customer/customer.module';
import { SupplierModule } from '../supplier/supplier.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BankAccountModule } from '../bank-account/bank-account.module';

/**
 * The central accounting engine + Journal Entries feature. Exposes the manual
 * Journal Entries API and exports {@link JournalEntryService} so any module
 * (opening balances now; sales, purchases, … later) posts to the ledger through
 * the one validated, transaction-joining `createSystemJournalEntry` path.
 * Manual entries are mirrored into the party/cash subledgers by
 * {@link JournalEntrySubledgerService}.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntry,
      JournalEntryLine,
      ChartOfAccount,
      FiscalYear,
      AccountingPeriod,
      Branch,
      User,
      AccountingSetting,
      Customer,
      Supplier,
      Treasury,
      BankAccount,
    ]),
    SequenceModule,
    CustomerModule,
    SupplierModule,
    TreasuryModule,
    BankAccountModule,
  ],
  controllers: [JournalEntryController],
  providers: [JournalEntryService, JournalEntrySubledgerService],
  exports: [JournalEntryService, TypeOrmModule],
})
export class JournalEntryModule {}
