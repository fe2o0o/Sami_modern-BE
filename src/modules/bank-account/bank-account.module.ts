import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankAccount } from './entities/bank-account.entity';
import { BankTransaction } from './entities/bank-transaction.entity';
import { BankAccountService } from './bank-account.service';
import { BankLedgerService } from './bank-ledger.service';
import { BankAccountController } from './bank-account.controller';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Branch } from '../branch/entities/branch.entity';

/**
 * Bank accounts — operational bank entities mapped to GL bank accounts. Exports
 * {@link BankLedgerService} so future modules record bank movements through one
 * path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BankAccount, BankTransaction, ChartOfAccount, Branch]),
  ],
  controllers: [BankAccountController],
  providers: [BankAccountService, BankLedgerService],
  exports: [BankAccountService, BankLedgerService, TypeOrmModule],
})
export class BankAccountModule {}
