import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Update payload for the single company record. Every field is optional so the
 * settings page can send partial updates. All messages are Arabic.
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الكود يجب أن يكون نصاً' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'اسم الشركة يجب أن يكون نصاً' })
  @MaxLength(255, { message: 'اسم الشركة يجب ألا يتجاوز 255 حرفاً' })
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الاسم القانوني يجب أن يكون نصاً' })
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم السجل التجاري يجب أن يكون نصاً' })
  commercialRegistration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الرقم الضريبي يجب أن يكون نصاً' })
  taxNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم تسجيل ضريبة القيمة المضافة يجب أن يكون نصاً' })
  vatNumber?: string;

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
  @IsString({ message: 'الموقع الإلكتروني يجب أن يكون نصاً' })
  website?: string;

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
  @IsString({ message: 'الرمز البريدي يجب أن يكون نصاً' })
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'العملة يجب أن تكون نصاً' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'اللغة يجب أن تكون نصاً' })
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'المنطقة الزمنية يجب أن تكون نصاً' })
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'بداية السنة المالية يجب أن تكون نصاً' })
  fiscalYearStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الشعار يجب أن يكون نصاً' })
  logo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
