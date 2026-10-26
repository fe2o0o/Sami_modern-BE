import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../employee/entities/employee.entity';
import { CodeSettingModule } from '../code-setting/code-setting.module';
import { Department } from './entities/department.entity';
import { JobGrade } from './entities/job-grade.entity';
import { EmployeeStatusChange } from './entities/employee-status-change.entity';
import { EmployeeDocument } from './entities/employee-document.entity';
import { PayComponent } from './entities/pay-component.entity';
import { SalaryPackage, SalaryPackageLine } from './entities/salary-package.entity';
import { EmployeeAdvance, EmployeeAdvanceInstallment, EmployeeAdvanceRepayment } from './entities/employee-advance.entity';
import { EmployeeCustody, EmployeeCustodySettlement } from './entities/employee-custody.entity';
import { SequenceModule } from '../sequence/sequence.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { BankAccountModule } from '../bank-account/bank-account.module';
import { HrPostingHelper } from './hr-posting.helper';
import { AdvanceService } from './advance.service';
import { CustodyService } from './custody.service';
import { EmployeeStatementService } from './employee-statement.service';
import { HrMoneyController } from './hr-money.controller';
import { DepartmentService, JobGradeService } from './hr-lookup.service';
import { EmployeeHrService } from './employee-hr.service';
import { SalaryService } from './salary.service';
import { HrController } from './hr.controller';
import { EmployeeHrController } from './employee-hr.controller';

/** Mini HR — phase 1 (employee profile), 2 (salary structure), 3 (advances, custody, employee statement). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee, Department, JobGrade, EmployeeStatusChange, EmployeeDocument, PayComponent, SalaryPackage, SalaryPackageLine,
      EmployeeAdvance, EmployeeAdvanceInstallment, EmployeeAdvanceRepayment, EmployeeCustody, EmployeeCustodySettlement,
    ]),
    CodeSettingModule,
    SequenceModule,
    JournalEntryModule,
    TreasuryModule,
    BankAccountModule,
  ],
  controllers: [HrController, EmployeeHrController, HrMoneyController],
  providers: [DepartmentService, JobGradeService, EmployeeHrService, SalaryService, HrPostingHelper, AdvanceService, CustodyService, EmployeeStatementService],
  exports: [EmployeeHrService, SalaryService],
})
export class HrModule {}
