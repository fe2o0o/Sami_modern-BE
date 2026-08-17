import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'مدير النظام' })
  @IsString({ message: 'الاسم بالكامل مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  fullName!: string;

  @ApiProperty({ example: 'admin' })
  @IsString({ message: 'اسم المستخدم مطلوب' })
  @MaxLength(100, { message: 'اسم المستخدم يجب ألا يتجاوز 100 حرف' })
  username!: string;

  @ApiProperty({ example: 'admin@samy.com' })
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email!: string;

  @ApiProperty({ example: 'Admin@123' })
  @IsString({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  password!: string;

  @ApiProperty({ example: 'Admin@123' })
  @IsString({ message: 'تأكيد كلمة المرور مطلوب' })
  confirmPassword!: string;

  @ApiProperty({ description: 'معرّف الدور' })
  @IsUUID('4', { message: 'الدور مطلوب' })
  roleId!: string;

  @ApiProperty({ description: 'معرّف الفرع' })
  @IsUUID('4', { message: 'الفرع مطلوب' })
  branchId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  phone?: string;

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
