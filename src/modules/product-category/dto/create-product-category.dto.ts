import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateProductCategoryDto {
  @ApiPropertyOptional({ example: 'CAT-100', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود التصنيف غير صحيح' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'غرف نوم' })
  @IsString({ message: 'اسم التصنيف مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional({ example: 'Bedrooms' })
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصاً' })
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'التصنيف الأب غير صالح' })
  parentId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
