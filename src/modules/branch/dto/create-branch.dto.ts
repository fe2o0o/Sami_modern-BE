import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @ApiPropertyOptional({ example: 'BR-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود الفرع يجب أن يكون نصاً' })
  @MaxLength(50, { message: 'كود الفرع يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'الفرع الرئيسي' })
  @IsString({ message: 'اسم الفرع مطلوب' })
  @MaxLength(255, { message: 'اسم الفرع يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'اسم المدير يجب أن يكون نصاً' })
  managerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الجوال يجب أن يكون نصاً' })
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الدولة يجب أن تكون نصاً' })
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'المدينة يجب أن تكون نصاً' })
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'العنوان يجب أن يكون نصاً' })
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({}, { message: 'خط العرض يجب أن يكون رقماً' })
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({}, { message: 'خط الطول يجب أن يكون رقماً' })
  longitude?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'قيمة الفرع الرئيسي يجب أن تكون منطقية' })
  isMain?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;
}
