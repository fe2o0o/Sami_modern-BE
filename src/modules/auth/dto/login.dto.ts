import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'admin',
    description: 'اسم المستخدم أو البريد الإلكتروني',
  })
  @IsString({ message: 'اسم المستخدم أو البريد الإلكتروني مطلوب' })
  login!: string;

  @ApiProperty({ example: 'Admin@123' })
  @IsString({ message: 'كلمة المرور مطلوبة' })
  password!: string;
}
