import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PayCalcType, PayComponentType } from '../enums/hr.enum';

export class CreatePayComponentDto {
  @ApiPropertyOptional({ example: 'TRANSPORT', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود البند غير صحيح' })
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'بدل انتقال' })
  @IsString({ message: 'اسم البند مطلوب' })
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string | null;

  @ApiProperty({ enum: PayComponentType })
  @IsEnum(PayComponentType, { message: 'نوع البند غير صحيح (استحقاق أو استقطاع)' })
  componentType!: PayComponentType;

  @ApiPropertyOptional({ enum: PayCalcType, default: PayCalcType.FIXED })
  @IsOptional()
  @IsEnum(PayCalcType, { message: 'طريقة حساب البند غير صحيحة' })
  calcType?: PayCalcType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'القيمة الافتراضية يجب أن تكون رقماً' })
  @Min(0, { message: 'القيمة الافتراضية يجب ألا تكون سالبة' })
  defaultValue?: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID(undefined, { message: 'الحساب المحاسبي غير صحيح' })
  accountId?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayComponentDto extends PartialType(CreatePayComponentDto) {}

export class SalaryPackageLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'بند الراتب غير صحيح' })
  payComponentId!: string;

  /** Amount, or the percentage for a «% of basic» component. */
  @ApiProperty()
  @IsNumber({}, { message: 'قيمة البند يجب أن تكون رقماً' })
  @Min(0, { message: 'قيمة البند يجب ألا تكون سالبة' })
  value!: number;
}

/** A new salary package for an employee, effective from a date. */
export class CreateSalaryPackageDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ السريان غير صحيح' })
  effectiveFrom!: string;

  @ApiProperty({ type: [SalaryPackageLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'أضف بند الراتب الأساسي على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => SalaryPackageLineDto)
  lines!: SalaryPackageLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
