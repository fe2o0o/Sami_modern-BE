import { CompanyModule } from '../company/company.module';
import { EmployeeModule } from '../employee/employee.module';
import { MySalesService } from './my-sales.service';
import { HrModule } from '../hr/hr.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Employee } from '../employee/entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { AttendanceShift } from './entities/attendance-shift.entity';
import { AttendanceHoliday } from './entities/attendance-holiday.entity';
import { AttendancePunch } from './entities/attendance-punch.entity';
import { AttendanceCalcService } from './attendance-calc.service';
import { AttendancePunchService } from './attendance-punch.service';
import { AttendanceService } from './attendance.service';
import { EmployeeAppAuthService } from './employee-app-auth.service';
import { EmployeeAppGuard } from './employee-app.guard';
import { AttendanceController } from './attendance.controller';
import { EmployeeAppController } from './employee-app.controller';
import { EmployeePortalController } from './employee-portal.controller';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { HrRequestService } from './hr-request.service';
import { PortalService } from './portal.service';
import { LeaveType } from './entities/leave-type.entity';
import { EmployeeLeaveBalance } from './entities/employee-leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { HrRequest } from './entities/hr-request.entity';
import { CustomerModule } from '../customer/customer.module';
import { AttendancePermission } from './entities/attendance-permission.entity';
import { AttendanceSetting } from './entities/attendance-setting.entity';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';

/** HR self-service: attendance (phase 4), leave (phase 5), HR requests and «بوابة الموظف» API (Egypt time). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Branch, AttendanceShift, AttendanceHoliday, AttendancePunch, LeaveType, EmployeeLeaveBalance, LeaveRequest, HrRequest, AttendancePermission, AttendanceSetting]),
    CustomerModule,
    CompanyModule, // Company Profile shown in the employee portal
    EmployeeModule, // EmployeeCommissionReportService → «مبيعاتي»
    HrModule, // AdvanceService: approved advance requests become employee advances
    // Secrets are passed per call (the employee-app key is derived from jwt.secret).
    JwtModule.register({}),
  ],
  controllers: [AttendanceController, EmployeeAppController, EmployeePortalController, LeaveController, PermissionController],
  providers: [AttendanceCalcService, AttendancePunchService, AttendanceService, EmployeeAppAuthService, EmployeeAppGuard, LeaveService, HrRequestService, PortalService, MySalesService, PermissionService],
  exports: [AttendanceCalcService, AttendanceService],
})
export class AttendanceModule {}
