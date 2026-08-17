import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChartOfAccount } from './entities/chart-of-account.entity';
import { ChartOfAccountService } from './chart-of-account.service';
import { ChartOfAccountController } from './chart-of-account.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChartOfAccount])],
  controllers: [ChartOfAccountController],
  providers: [ChartOfAccountService],
  exports: [ChartOfAccountService, TypeOrmModule],
})
export class ChartOfAccountModule {}
