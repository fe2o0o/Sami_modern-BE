import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A production stage in the master list (تقطيع، نجارة …). */
export class CreateManufacturingStageDto {
  @ApiProperty({ description: 'اسم المرحلة' })
  @Transform(trim)
  @IsString({ message: 'اسم المرحلة مطلوب' })
  @IsNotEmpty({ message: 'اسم المرحلة مطلوب' })
  @MaxLength(100, { message: 'اسم المرحلة طويل جداً' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(100, { message: 'الاسم بالإنجليزية طويل جداً' })
  nameEn?: string | null;

  @ApiPropertyOptional({ description: 'الترتيب الافتراضي' })
  @IsOptional()
  @IsInt({ message: 'الترتيب يجب أن يكون رقماً صحيحاً' })
  @Min(0, { message: 'الترتيب لا يمكن أن يكون سالباً' })
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'المدة المعتادة بالأيام' })
  @IsOptional()
  @IsInt({ message: 'المدة يجب أن تكون عدد أيام صحيحاً' })
  @Min(0, { message: 'المدة لا يمكن أن تكون سالبة' })
  defaultDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}

export class UpdateManufacturingStageDto extends PartialType(CreateManufacturingStageDto) {}

/** One stage on a product's route or an order's stage list (in the array's order). */
export class StageRouteLineDto {
  /** Existing order-stage row (keeps its progress); omitted for a new line. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'سطر المرحلة غير صحيح' })
  id?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'اختر المرحلة' })
  stageId!: string;

  @ApiPropertyOptional({ description: 'المدة المتوقعة بالأيام' })
  @IsOptional()
  @IsInt({ message: 'المدة يجب أن تكون عدد أيام صحيحاً' })
  @Min(0, { message: 'المدة لا يمكن أن تكون سالبة' })
  expectedDays?: number | null;
}

/** Start / finish / undo a stage — optional note kept on the stage. */
export class StageProgressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'الملاحظة طويلة جداً' })
  notes?: string | null;
}
