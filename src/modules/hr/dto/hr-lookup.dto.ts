import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiPropertyOptional({ example: 'DEP-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود القسم غير صحيح' })
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'المبيعات' })
  @IsString({ message: 'اسم القسم مطلوب' })
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'مدير القسم غير صحيح' })
  managerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreateJobGradeDto {
  @ApiPropertyOptional({ example: 'GRD-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود الدرجة غير صحيح' })
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'أخصائي أول' })
  @IsString({ message: 'اسم الدرجة مطلوب' })
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string | null;

  /** The grade this one reports to (null = top of the hierarchy). */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID(undefined, { message: 'الدرجة الأعلى غير صحيحة' })
  parentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobGradeDto extends PartialType(CreateJobGradeDto) {}
