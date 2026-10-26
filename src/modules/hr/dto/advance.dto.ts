import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AdvanceStatus, CustodySettlementType, CustodyStatus, HrCashMethod } from '../enums/advance.enum';

/** Treasury / bank the money moves through. */
export class HrCashDto {
  @ApiProperty({ enum: HrCashMethod })
  @IsEnum(HrCashMethod, { message: 'طريقة الدفع غير صحيحة (خزينة أو بنك)' })
  method!: HrCashMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الخزينة غير صحيحة' })
  treasuryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الحساب البنكي غير صحيح' })
  bankAccountId?: string | null;
}

export class InstallmentInputDto {
  @ApiProperty({ format: 'date', description: 'شهر الاستحقاق (أي يوم فيه)' })
  @IsDateString({}, { message: 'شهر القسط غير صحيح' })
  dueMonth!: string;

  @ApiProperty()
  @IsNumber({}, { message: 'مبلغ القسط يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ القسط يجب أن يكون أكبر من صفر' })
  amount!: number;
}

export class CreateAdvanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'الموظف غير صحيح' })
  employeeId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الطلب غير صحيح' })
  requestDate!: string;

  @ApiProperty()
  @IsNumber({}, { message: 'مبلغ السلفة يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ السلفة يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiProperty({ default: 1 })
  @IsInt({ message: 'عدد الأقساط يجب أن يكون رقماً صحيحاً' })
  @Min(1, { message: 'عدد الأقساط يجب أن يكون 1 على الأقل' })
  @Max(120, { message: 'عدد الأقساط كبير جداً' })
  installmentsCount!: number;

  @ApiProperty({ format: 'date', description: 'أول شهر خصم (أي يوم فيه)' })
  @IsDateString({}, { message: 'أول شهر خصم غير صحيح' })
  firstDeductionMonth!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  /** Optional custom schedule (must add up to the amount). Default: equal monthly installments. */
  @ApiPropertyOptional({ type: [InstallmentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentInputDto)
  installments?: InstallmentInputDto[];
}

export class UpdateAdvanceDto extends CreateAdvanceDto {}

export class PayAdvanceDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الصرف غير صحيح' })
  paidDate!: string;

  @ApiProperty({ type: HrCashDto })
  @ValidateNested()
  @Type(() => HrCashDto)
  cash!: HrCashDto;
}

export class RepayAdvanceDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ السداد غير صحيح' })
  repaymentDate!: string;

  @ApiProperty()
  @IsNumber({}, { message: 'مبلغ السداد يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ السداد يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiProperty({ type: HrCashDto })
  @ValidateNested()
  @Type(() => HrCashDto)
  cash!: HrCashDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Cancel (before payment) or reverse (after) — reason + date. */
export class HrReasonDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'السبب مطلوب (3 أحرف على الأقل)' })
  reason!: string;

  @ApiPropertyOptional({ format: 'date', description: 'تاريخ العكس (افتراضي: اليوم)' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  date?: string;
}

export class AdvanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AdvanceStatus })
  @IsOptional()
  @IsEnum(AdvanceStatus)
  status?: AdvanceStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** open = paid and not fully repaid. */
  @ApiPropertyOptional({ enum: ['open'] })
  @IsOptional()
  @IsIn(['open'])
  state?: 'open';
}

// ── custody ──
export class CreateCustodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'الموظف غير صحيح' })
  employeeId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ العهدة غير صحيح' })
  custodyDate!: string;

  @ApiProperty()
  @IsNumber({}, { message: 'مبلغ العهدة يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ العهدة يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purpose?: string;

  @ApiProperty({ type: HrCashDto })
  @ValidateNested()
  @Type(() => HrCashDto)
  cash!: HrCashDto;
}

export class UpdateCustodyDto extends CreateCustodyDto {}

export class CustodyExpenseLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'حساب المصروف غير صحيح' })
  accountId!: string;

  @ApiProperty()
  @IsNumber({}, { message: 'مبلغ المصروف يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ المصروف يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class SettleCustodyDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ التسوية غير صحيح' })
  settlementDate!: string;

  @ApiProperty({ enum: CustodySettlementType })
  @IsEnum(CustodySettlementType, { message: 'نوع التسوية غير صحيح' })
  settlementType!: CustodySettlementType;

  /** Cash return: the amount + where it goes. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً' })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount?: number;

  @ApiPropertyOptional({ type: HrCashDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => HrCashDto)
  cash?: HrCashDto;

  /** Expenses: one line per expense account. */
  @ApiPropertyOptional({ type: [CustodyExpenseLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'أضف بند مصروف واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => CustodyExpenseLineDto)
  expenseLines?: CustodyExpenseLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CustodyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CustodyStatus })
  @IsOptional()
  @IsEnum(CustodyStatus)
  status?: CustodyStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
