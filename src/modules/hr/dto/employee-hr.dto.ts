import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { EmployeeDocumentType, EmploymentStatus } from '../enums/hr.enum';

/** Move an employee to another employment status (history row is kept). */
export class ChangeEmployeeStatusDto {
  @ApiProperty({ enum: EmploymentStatus })
  @IsEnum(EmploymentStatus, { message: 'حالة الموظف غير صحيحة' })
  status!: EmploymentStatus;

  /** Effective date — the last working day for resigned / terminated. */
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ تغيير الحالة غير صحيح' })
  effectiveDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'سبب تغيير الحالة مطلوب (3 أحرف على الأقل)' })
  @MaxLength(1000)
  reason?: string;
}

/** Metadata sent with a document upload (multipart fields). */
export class UploadEmployeeDocumentDto {
  @ApiPropertyOptional({ enum: EmployeeDocumentType, default: EmployeeDocumentType.OTHER })
  @IsOptional()
  @IsEnum(EmployeeDocumentType, { message: 'نوع المستند غير صحيح' })
  documentType?: EmployeeDocumentType;

  @ApiPropertyOptional({ description: 'عنوان المستند (افتراضي: اسم الملف)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ انتهاء المستند غير صحيح' })
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
