import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
