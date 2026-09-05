import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiPropertyOptional({ example: 'CUS-0001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود العميل غير صحيح' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'شركة الأمل' })
  @IsString({ message: 'اسم العميل مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الجوال يجب أن يكون نصاً' })
  @MaxLength(30)
  mobile?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الرقم الضريبي يجب أن يكون نصاً' })
  @MaxLength(100)
  taxNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'العنوان يجب أن يكون نصاً' })
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'المدينة يجب أن تكون نصاً' })
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الدولة يجب أن تكون نصاً' })
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'حد الائتمان يجب أن يكون رقماً' })
  @Min(0, { message: 'حد الائتمان يجب ألا يكون سالباً' })
  creditLimit?: number;

  @ApiPropertyOptional({ description: 'مدة السداد بالأيام' })
  @IsOptional()
  @IsInt({ message: 'مدة السداد يجب أن تكون رقماً صحيحاً' })
  @Min(0, { message: 'مدة السداد يجب ألا تكون سالبة' })
  paymentTerms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
