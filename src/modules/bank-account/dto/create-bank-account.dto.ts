import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiPropertyOptional({ example: 'BNK-001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود الحساب غير صحيح' })
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'البنك التجاري الدولي CIB' })
  @IsString({ message: 'اسم البنك مطلوب' })
  @MaxLength(255)
  bankName!: string;

  @ApiProperty({ example: 'الحساب الرئيسي' })
  @IsString({ message: 'اسم الحساب مطلوب' })
  @MaxLength(255)
  accountName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountNumber?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  iban?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'الفروع التي يخدمها الحساب. اتركها فارغة ليكون متاحًا لكل الفروع.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'أحد الفروع المختارة غير صالح' })
  branchIds?: string[];

  @ApiProperty({ format: 'uuid', description: 'الحساب المحاسبي (بنك)' })
  @IsUUID('4', { message: 'يجب اختيار الحساب المحاسبي' })
  accountId!: string;

  @ApiPropertyOptional({ default: 'EGP' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currencyCode?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}
