import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { WarehouseType } from '../enums/warehouse-type.enum';

export class CreateWarehouseDto {
  @ApiPropertyOptional({ example: 'WH-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود المخزن يجب أن يكون نصاً' })
  @MaxLength(50, { message: 'كود المخزن يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'المخزن الرئيسي' })
  @IsString({ message: 'اسم المخزن مطلوب' })
  @MaxLength(255, { message: 'اسم المخزن يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiProperty({ enum: WarehouseType })
  @IsEnum(WarehouseType, { message: 'نوع المخزن غير صحيح' })
  type!: WarehouseType;

  @ApiPropertyOptional({ description: 'معرّف الفرع (اختياري — مخزن بدون فرع = مركزي)' })
  @IsOptional()
  @IsUUID('4', { message: 'الفرع غير صحيح' })
  branchId?: string | null;

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
  @IsEmail({}, { message: 'صيغة البريد الإلكتروني غير صحيحة' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'العنوان يجب أن يكون نصاً' })
  address?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'السماح بالرصيد السالب يجب أن يكون قيمة منطقية' })
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'المخزن الافتراضي يجب أن يكون قيمة منطقية' })
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;
}
