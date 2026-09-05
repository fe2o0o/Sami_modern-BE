import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateUnitDto {
  @ApiPropertyOptional({ example: 'PCS', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود الوحدة غير صحيح' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiProperty({ example: 'قطعة' })
  @IsString({ message: 'اسم الوحدة مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional({ example: 'Piece' })
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'ق' })
  @IsOptional()
  @IsString({ message: 'الرمز يجب أن يكون نصاً' })
  @MaxLength(50)
  symbol?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
