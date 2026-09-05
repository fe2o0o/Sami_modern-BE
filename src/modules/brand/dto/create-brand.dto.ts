import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateBrandDto {
  @ApiPropertyOptional({ example: 'IKEA', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود العلامة غير صحيح' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'ايكيا' })
  @IsString({ message: 'اسم العلامة مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional({ example: 'IKEA' })
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الشعار يجب أن يكون نصاً' })
  @MaxLength(500)
  logo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصاً' })
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
