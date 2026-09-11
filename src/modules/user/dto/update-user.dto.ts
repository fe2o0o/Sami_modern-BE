import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Admin update payload. Password and username are intentionally NOT editable
 * here (password has its own reset flow).
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الاسم يجب أن يكون نصاً' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'الدور غير صحيح' })
  roleId?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'الفروع المخصّصة للمستخدم (تستبدل القائمة الحالية بالكامل).',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'أحد الفروع المختارة غير صالح' })
  branchIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الرقم الوظيفي يجب أن يكون نصاً' })
  employeeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الصورة يجب أن تكون نصاً' })
  avatar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
