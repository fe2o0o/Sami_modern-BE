import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { JournalEntryService } from './journal-entry.service';
import { JournalEntryController } from './journal-entry.controller';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { SequenceModule } from '../sequence/sequence.module';

/**
 * The central accounting engine + Journal Entries feature. Exposes the manual
 * Journal Entries API and exports {@link JournalEntryService} so any module
 * (opening balances now; sales, purchases, … later) posts to the ledger through
 * the one validated, transaction-joining `createSystemJournalEntry` path.
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
    ]),
    SequenceModule,
  ],
  controllers: [JournalEntryController],
  providers: [JournalEntryService],
  exports: [JournalEntryService, TypeOrmModule],
})
export class JournalEntryModule {}
