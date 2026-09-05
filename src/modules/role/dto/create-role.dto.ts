import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'WAREHOUSE_KEEPER', description: 'كود فريد بالإنجليزية' })
  @IsString()
  @Length(2, 50, { message: 'الكود يجب أن يكون بين 2 و50 حرفاً' })
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'الكود يجب أن يكون أحرفاً إنجليزية كبيرة وأرقاماً وشرطات سفلية فقط',
  })
  code!: string;

  @ApiProperty({ example: 'أمين مخزن' })
  @IsString()
  @Length(2, 100, { message: 'اسم الدور مطلوب' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'مفاتيح الصلاحيات الممنوحة' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
