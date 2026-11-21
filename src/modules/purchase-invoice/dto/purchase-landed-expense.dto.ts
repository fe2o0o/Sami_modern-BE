import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { LandedAllocation } from '../landed-cost.util';

/** One landed expense on a purchase invoice (freight, loading …), paid from a treasury or bank. */
export class PurchaseLandedExpenseDto {
  @ApiProperty({ description: 'البيان (نقل، تحميل …)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'بيان المصروف مطلوب' })
  @IsNotEmpty({ message: 'بيان المصروف مطلوب' })
  @MaxLength(255, { message: 'بيان المصروف طويل جداً' })
  description!: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({}, { message: 'مبلغ المصروف يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ المصروف يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiProperty({ enum: LandedAllocation })
  @IsEnum(LandedAllocation, { message: 'طريقة توزيع المصروف غير صحيحة' })
  allocation!: LandedAllocation;

  @ApiPropertyOptional({ description: 'رقم السطر (عند التحميل على صنف معيّن)' })
  @ValidateIf((o: PurchaseLandedExpenseDto) => o.allocation === LandedAllocation.LINE)
  @IsInt({ message: 'اختر الصنف الذي يُحمَّل عليه المصروف' })
  @Min(1, { message: 'اختر الصنف الذي يُحمَّل عليه المصروف' })
  targetLineNumber?: number | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'الخزنة التي يُصرف منها' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الخزنة غير صحيحة' })
  treasuryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'الحساب البنكي الذي يُصرف منه' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الحساب البنكي غير صحيح' })
  bankAccountId?: string | null;
}
