import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-0001' })
  @IsString({ message: 'كود المورد مطلوب' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code!: string;

  @ApiProperty({ example: 'مصنع الخشب الحديث' })
  @IsString({ message: 'اسم المورد مطلوب' })
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
