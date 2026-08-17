import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString({ message: 'كلمة المرور الحالية مطلوبة' })
  currentPassword!: string;

  @ApiProperty({ minLength: 6 })
  @IsString({ message: 'كلمة المرور الجديدة مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب ألا تقل عن 6 أحرف' })
  newPassword!: string;

  @ApiProperty()
  @IsString({ message: 'تأكيد كلمة المرور مطلوب' })
  confirmPassword!: string;
}
