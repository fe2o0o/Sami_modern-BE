import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingSetting } from './entities/accounting-setting.entity';
import { AccountingSettingService } from './accounting-setting.service';
import { AccountingSettingController } from './accounting-setting.controller';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccountingSetting, ChartOfAccount])],
  controllers: [AccountingSettingController],
  providers: [AccountingSettingService],
  exports: [AccountingSettingService, TypeOrmModule],
})
export class AccountingSettingModule {}
