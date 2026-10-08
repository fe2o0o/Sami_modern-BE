import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Request body for POST /ai/chat. */
export class ChatDto {
  @ApiProperty({ example: 'كام مبيعات شهر أغسطس؟', description: 'رسالة المستخدم (عربي أو إنجليزي)' })
  @IsString()
  @MinLength(1, { message: 'الرسالة مطلوبة' })
  @MaxLength(4000, { message: 'الرسالة طويلة جداً' })
  message!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'معرّف المحادثة لاستكمال السياق (اختياري)' })
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}
