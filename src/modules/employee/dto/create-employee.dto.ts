import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ContractType, Gender, MaritalStatus } from '../../hr/enums/hr.enum';

export class CreateEmployeeDto {
  @ApiPropertyOptional({ example: 'EMP-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود الموظف غير صحيح' })
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'أحمد محمد' })
  @IsString({ message: 'اسم الموظف مطلوب' })
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mobile?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nationalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobTitle?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'الفروع التي يخدمها الموظف. اتركها فارغة ليكون متاحًا لكل الفروع.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'أحد الفروع المختارة غير صالح' })
  branchIds?: string[];

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ التعيين غير صحيح' })
  hireDate?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'المرتب يجب أن يكون رقماً' })
  @Min(0, { message: 'المرتب يجب ألا يكون سالباً' })
  netSalary?: number;

  @ApiPropertyOptional({ default: 0, description: 'نسبة العمولة الافتراضية %' })
  @IsOptional()
  @IsNumber({}, { message: 'نسبة العمولة يجب أن تكون رقماً' })
  @Min(0, { message: 'نسبة العمولة يجب ألا تكون سالبة' })
  commissionRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  /** Initial status on create only — later changes go through POST /employees/:id/status. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ── HR profile ──
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'القسم غير صحيح' })
  departmentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'الدرجة الوظيفية غير صحيحة' })
  jobGradeId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'المدير المباشر غير صحيح' })
  directManagerId?: string | null;

  @ApiPropertyOptional({ enum: ContractType, nullable: true })
  @IsOptional()
  @IsEnum(ContractType, { message: 'نوع العقد غير صحيح' })
  contractType?: ContractType | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ بداية العقد غير صحيح' })
  contractStart?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ نهاية العقد غير صحيح' })
  contractEnd?: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ الميلاد غير صحيح' })
  birthDate?: string | null;

  @ApiPropertyOptional({ enum: Gender, nullable: true })
  @IsOptional()
  @IsEnum(Gender, { message: 'النوع غير صحيح' })
  gender?: Gender | null;

  @ApiPropertyOptional({ enum: MaritalStatus, nullable: true })
  @IsOptional()
  @IsEnum(MaritalStatus, { message: 'الحالة الاجتماعية غير صحيحة' })
  maritalStatus?: MaritalStatus | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  qualification?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  socialInsuranceNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bankName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankAccountNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  iban?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  emergencyContactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactRelation?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  emergencyContactMobile?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'مستخدم النظام غير صحيح' })
  userId?: string | null;
}
