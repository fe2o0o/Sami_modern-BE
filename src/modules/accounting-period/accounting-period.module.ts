import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { AccountingPeriodService } from './accounting-period.service';
import { AccountingPeriodController } from './accounting-period.controller';
import { AccountingPeriodGeneratorService } from './services/accounting-period-generator.service';

/**
 * Owns accounting periods and the reusable generator.
 * NOTE: must not import FiscalYearModule — FiscalYearModule imports this one.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AccountingPeriod])],
  controllers: [AccountingPeriodController],
  providers: [AccountingPeriodService, AccountingPeriodGeneratorService],
  exports: [AccountingPeriodService, AccountingPeriodGeneratorService, TypeOrmModule],
})
export class AccountingPeriodModule {}
