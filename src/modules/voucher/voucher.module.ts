import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Voucher } from './entities/voucher.entity';
import { VoucherService } from './voucher.service';
import { VoucherPostingService } from './voucher-posting.service';
import { VoucherController } from './voucher.controller';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { Branch } from '../branch/entities/branch.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { User } from '../user/entities/user.entity';
import { SequenceModule } from '../sequence/sequence.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { CustomerModule } from '../customer/customer.module';
import { SupplierModule } from '../supplier/supplier.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BankAccountModule } from '../bank-account/bank-account.module';

/**
 * Receipt & Payment vouchers. Posting/reversal reuse the shared engines —
 * SequenceService, the central JournalEntryService, and the customer / supplier
 * / treasury / bank subledgers — so every effect stays atomic.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Voucher,
      Customer,
      Supplier,
      Treasury,
      BankAccount,
      Branch,
      AccountingPeriod,
      FiscalYear,
      AccountingSetting,
      User,
    ]),
    SequenceModule,
    JournalEntryModule,
    CustomerModule,
    SupplierModule,
    TreasuryModule,
    BankAccountModule,
  ],
  controllers: [VoucherController],
  providers: [VoucherService, VoucherPostingService],
  exports: [VoucherService],
})
export class VoucherModule {}
