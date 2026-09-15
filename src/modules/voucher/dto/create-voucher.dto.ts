import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { VoucherPartyType, VoucherPaymentMethod, VoucherType } from '../enums/voucher.enum';

/** Create a receipt/payment voucher (always starts DRAFT — no accounting effect). */
export class CreateVoucherDto {
  @ApiProperty({ enum: VoucherType })
  @IsEnum(VoucherType, { message: 'نوع السند غير صحيح' })
  type!: VoucherType;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ السند غير صحيح' })
  voucherDate!: string;

  @ApiPropertyOptional({ enum: VoucherPartyType, default: VoucherPartyType.SUPPLIER })
  @IsOptional()
  @IsEnum(VoucherPartyType, { message: 'نوع الطرف غير صحيح' })
  partyType?: VoucherPartyType;

  @ApiPropertyOptional({ format: 'uuid', description: 'العميل (قبض) أو المورّد (صرف) — عند اختيار طرف' })
  @ValidateIf((o) => o.partyType !== VoucherPartyType.ACCOUNT)
  @IsUUID('4', { message: 'يجب اختيار الطرف' })
  partyId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'الحساب المحاسبي (مصروف/إيراد) — عند اختيار حساب' })
  @ValidateIf((o) => o.partyType === VoucherPartyType.ACCOUNT)
  @IsUUID('4', { message: 'يجب اختيار الحساب' })
  accountId?: string | null;

  @ApiProperty({ enum: VoucherPaymentMethod })
  @IsEnum(VoucherPaymentMethod, { message: 'طريقة الدفع غير صحيحة' })
  paymentMethod!: VoucherPaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o) => o.paymentMethod === VoucherPaymentMethod.TREASURY)
  @IsUUID('4', { message: 'يجب اختيار الخزينة' })
  treasuryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((o) => o.paymentMethod === VoucherPaymentMethod.BANK)
  @IsUUID('4', { message: 'يجب اختيار الحساب البنكي' })
  bankAccountId?: string | null;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({}, { message: 'المبلغ يجب أن يكون رقماً' })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'رقم شيك/تحويل' })
  @IsOptional()
  @IsString()
  reference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}
