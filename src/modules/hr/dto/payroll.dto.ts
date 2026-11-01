import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PayrollAdjustmentKind, PayrollStatus } from '../enums/payroll.enum';
import { HrCashDto } from './advance.dto';

export class CreatePayrollRunDto {
  @ApiProperty({ format: 'uuid', description: 'الفرع — مسير واحد لكل فرع في الشهر' })
  @IsUUID(undefined, { message: 'اختر الفرع' })
  branchId!: string;

  @ApiProperty({ example: '2026-11', description: 'الشهر YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'الشهر غير صحيح (YYYY-MM)' })
  month!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class PayrollComponentOverrideDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'بند الراتب غير صحيح' })
  payComponentId!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً' })
  @Min(0, { message: 'المبلغ لا يمكن أن يكون سالباً' })
  amount!: number;
}

export class PayrollAdjustmentDto {
  @ApiProperty({ enum: PayrollAdjustmentKind })
  @IsEnum(PayrollAdjustmentKind, { message: 'النوع: مكافأة أو جزاء' })
  kind!: PayrollAdjustmentKind;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً' })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Edit one draft line: component amounts (taxes / insurance / allowances), commission, advance installment, bonuses & penalties, note. */
export class UpdatePayrollLineDto {
  @ApiPropertyOptional({ type: [PayrollComponentOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollComponentOverrideDto)
  components?: PayrollComponentOverrideDto[];

  @ApiPropertyOptional({ type: [PayrollAdjustmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollAdjustmentDto)
  adjustments?: PayrollAdjustmentDto[];

  /** Commission of the month set by hand; null = back to the calculated amount. */
  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({}, { message: 'العمولة يجب أن تكون رقماً' })
  @Min(0, { message: 'العمولة لا يمكن أن تكون سالبة' })
  commissionOverride?: number | null;

  /** Advance installment to deduct this month; null = as much as the pay allows. */
  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({}, { message: 'قسط السلفة يجب أن يكون رقماً' })
  @Min(0, { message: 'قسط السلفة لا يمكن أن يكون سالباً' })
  advanceOverride?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class PayPayrollDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الصرف غير صحيح' })
  paymentDate!: string;

  @ApiProperty({ type: HrCashDto })
  @ValidateNested()
  @Type(() => HrCashDto)
  cash!: HrCashDto;

  /** Lines to pay — empty / omitted = every unpaid line. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر موظفاً واحداً على الأقل' })
  @IsUUID(undefined, { each: true, message: 'سطر غير صحيح' })
  lineIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class PayrollQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: PayrollStatus })
  @IsOptional()
  @IsEnum(PayrollStatus)
  status?: PayrollStatus;

  @ApiPropertyOptional({ example: '2026' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'السنة غير صحيحة' })
  year?: string;
}
