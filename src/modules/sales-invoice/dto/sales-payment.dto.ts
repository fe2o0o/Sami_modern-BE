import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/** One part of the collection — e.g. part cash in a treasury, the rest to a bank. */
export class SalesPaymentDto {
  @ApiProperty({ format: 'uuid', description: 'حساب الخزنة / البنك' })
  @IsUUID(undefined, { message: 'حساب التحصيل غير صحيح' })
  cashAccountId!: string;

  /** Which treasury / bank exactly — needed when several share one GL account. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الخزنة غير صحيحة' })
  treasuryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'الحساب البنكي غير صحيح' })
  bankAccountId?: string | null;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({}, { message: 'المبلغ المحصّل يجب أن يكون رقماً' })
  @Min(0.01, { message: 'المبلغ المحصّل يجب أن يكون أكبر من صفر' })
  amount!: number;
}
