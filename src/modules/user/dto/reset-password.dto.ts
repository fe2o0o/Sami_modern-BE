import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Admin reset-password payload. If `password` is omitted, the server generates
 * a strong random password and returns it once.
 */
export class ResetPasswordDto {
  @ApiPropertyOptional({
    description: 'كلمة مرور جديدة (اختياري — تُولَّد تلقائياً إذا تُركت فارغة)',
  })
  @IsOptional()
  @IsString({ message: 'كلمة المرور يجب أن تكون نصاً' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  password?: string;
}
