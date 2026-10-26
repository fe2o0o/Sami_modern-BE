import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { StatusQueryDto } from '../../../common/dto/status-query.dto';
import { ContractType, EmploymentStatus } from '../../hr/enums/hr.enum';

/** Employees list / summary filters. */
export class EmployeeQueryDto extends StatusQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الفرع غير صحيح' })
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'القسم غير صحيح' })
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الدرجة الوظيفية غير صحيحة' })
  jobGradeId?: string;

  @ApiPropertyOptional({ enum: EmploymentStatus })
  @IsOptional()
  @IsEnum(EmploymentStatus, { message: 'حالة الموظف غير صحيحة' })
  employmentStatus?: EmploymentStatus;

  @ApiPropertyOptional({ enum: ContractType })
  @IsOptional()
  @IsEnum(ContractType, { message: 'نوع العقد غير صحيح' })
  contractType?: ContractType;
}
