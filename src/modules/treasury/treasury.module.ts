import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Treasury } from './entities/treasury.entity';
import { TreasuryTransaction } from './entities/treasury-transaction.entity';
import { TreasuryService } from './treasury.service';
import { TreasuryLedgerService } from './treasury-ledger.service';
import { TreasuryController } from './treasury.controller';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Branch } from '../branch/entities/branch.entity';
import { CodeSettingModule } from '../code-setting/code-setting.module';

/**
 * Treasuries (cashboxes) — operational cash entities mapped to GL cash accounts.
 * Exports {@link TreasuryLedgerService} so future modules (opening balances,
 * receipts, cash sales) record treasury movements through one path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Treasury, TreasuryTransaction, ChartOfAccount, Branch]),
    CodeSettingModule,
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService, TreasuryLedgerService],
  exports: [TreasuryService, TreasuryLedgerService, TypeOrmModule],
})
export class TreasuryModule {}
