import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntryLine } from '../journal-entry/entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { TreasuryTransaction } from '../treasury/entities/treasury-transaction.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { BankTransaction } from '../bank-account/entities/bank-transaction.entity';
import { GeneralLedgerService } from './general-ledger.service';
import { TrialBalanceService } from './trial-balance.service';
import { FinancialStatementsService } from './financial-statements.service';
import { TreasuryCashReportService } from './treasury-cash-report.service';
import { AccountingReportController } from './accounting-report.controller';

/**
 * Read-only accounting reports (General Ledger, Trial Balance) derived from
 * POSTED journal lines. Owns no entities of its own — it only reads existing
 * accounting data.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntryLine,
      ChartOfAccount,
      FiscalYear,
      AccountingPeriod,
      Treasury,
      TreasuryTransaction,
      BankAccount,
      BankTransaction,
    ]),
  ],
  controllers: [AccountingReportController],
  providers: [GeneralLedgerService, TrialBalanceService, FinancialStatementsService, TreasuryCashReportService],
  exports: [GeneralLedgerService, TrialBalanceService, FinancialStatementsService, TreasuryCashReportService],
})
export class AccountingReportModule {}
