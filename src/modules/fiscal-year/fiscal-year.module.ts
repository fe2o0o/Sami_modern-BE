import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiscalYear } from './entities/fiscal-year.entity';
import { Role } from '../role/entities/role.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { AccountingPeriodModule } from '../accounting-period/accounting-period.module';
import { FiscalYearService } from './fiscal-year.service';
import { FiscalYearController } from './fiscal-year.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FiscalYear, Role, AccountingPeriod]),
    AccountingPeriodModule,
  ],
  controllers: [FiscalYearController],
  providers: [FiscalYearService],
  exports: [FiscalYearService, TypeOrmModule],
})
export class FiscalYearModule {}
