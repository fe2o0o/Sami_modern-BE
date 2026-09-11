import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { EmployeeService } from './employee.service';
import { EmployeeCommissionReportService } from './employee-commission-report.service';
import { EmployeeController } from './employee.controller';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, SalesInvoiceCommission, Branch]), CodeSettingModule],
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeCommissionReportService],
  exports: [EmployeeService, TypeOrmModule],
})
export class EmployeeModule {}
