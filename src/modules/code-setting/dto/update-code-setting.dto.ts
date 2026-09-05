import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class UpdateCodeSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoGenerate?: boolean;

  @ApiPropertyOptional({ description: 'بادئة الكود بالإنجليزية/الأرقام والشرطات' })
  @IsOptional()
  @IsString()
  @Length(0, 20, { message: 'البادئة يجب ألا تتجاوز 20 حرفاً' })
  @Matches(/^[A-Za-z0-9_-]*$/, { message: 'البادئة تسمح فقط بأحرف إنجليزية وأرقام وشرطات' })
  prefix?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'عدد الخانات يجب أن يكون 1 على الأقل' })
  @Max(12, { message: 'عدد الخانات يجب ألا يتجاوز 12' })
  padding?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'الرقم التالي (لإعادة ضبط العدّاد)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  nextNumber?: number;
}
