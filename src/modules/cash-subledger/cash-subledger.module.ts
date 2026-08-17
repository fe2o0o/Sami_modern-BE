import { Module } from '@nestjs/common';
import { TreasuryModule } from '../treasury/treasury.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { CashSubledgerService } from './cash-subledger.service';

/**
 * Provides {@link CashSubledgerService} — the bridge that mirrors a cash
 * document's cash/bank leg into the treasury/bank subledger. Depends on the
 * treasury + bank modules for their ledger services (and their entity repos).
 */
@Module({
  imports: [TreasuryModule, BankAccountModule],
  providers: [CashSubledgerService],
  exports: [CashSubledgerService],
})
export class CashSubledgerModule {}
