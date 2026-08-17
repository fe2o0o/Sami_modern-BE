import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AccountNature, AccountSubType, AccountType } from '../enums/account.enum';

export class CreateChartOfAccountDto {
  @ApiPropertyOptional({ description: 'الحساب الأب (فارغ للحساب الرئيسي)' })
  @IsOptional()
  @IsUUID('4', { message: 'الحساب الأب غير صحيح' })
  parentId?: string | null;

  @ApiProperty({ example: '1100' })
  @IsString({ message: 'كود الحساب مطلوب' })
  @MaxLength(50, { message: 'كود الحساب يجب ألا يتجاوز 50 حرفاً' })
  accountCode!: string;

  @ApiProperty({ example: 'النقدية' })
  @IsString({ message: 'اسم الحساب مطلوب' })
  @MaxLength(255, { message: 'اسم الحساب يجب ألا يتجاوز 255 حرفاً' })
  accountNameAr!: string;

  @ApiPropertyOptional({ example: 'Cash' })
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  accountNameEn?: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType, { message: 'نوع الحساب مطلوب' })
  accountType!: AccountType;

  @ApiProperty({ enum: AccountNature })
  @IsEnum(AccountNature, { message: 'طبيعة الحساب مطلوبة' })
  accountNature!: AccountNature;

  @ApiPropertyOptional({ enum: AccountSubType })
  @IsOptional()
  @IsEnum(AccountSubType, { message: 'تصنيف الحساب غير صحيح' })
  accountSubType?: AccountSubType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'العملة غير صحيحة' })
  currencyId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'قيمة الحساب الرئيسي يجب أن تكون منطقية' })
  isHeader?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'قيمة السماح بالترحيل يجب أن تكون منطقية' })
  allowPosting?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'حالة التفعيل يجب أن تكون قيمة منطقية' })
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصاً' })
  description?: string;
}
