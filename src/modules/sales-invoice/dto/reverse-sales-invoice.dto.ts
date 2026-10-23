import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

/** What to do with a linked manufacturing order that is still NEW / IN PROGRESS. */
export class ManufacturingReversalDecisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'أمر التصنيع غير صحيح' })
  orderId!: string;

  /** cancel = cancel the order (reverses its posted fee + the factory's balance);
   *  keep = let it continue — produced goods go into stock as normal inventory. */
  @ApiProperty({ enum: ['cancel', 'keep'] })
  @IsIn(['cancel', 'keep'], { message: 'اختر إلغاء أمر التصنيع أو استمراره' })
  action!: 'cancel' | 'keep';
}

/**
 * Reverse a POSTED sales invoice. Reverses inventory, the customer subledger and
 * the journal (opposite posted entry) inside one transaction, into the chosen
 * OPEN period on `reversalDate` — the original period is never reopened.
 * Refused while anything is delivered. The open delivery note is cancelled; each
 * NEW / IN-PROGRESS manufacturing order needs a decision (cancel or keep).
 */
export class ReverseSalesInvoiceDto {
  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3, { message: 'سبب العكس مطلوب (3 أحرف على الأقل)' })
  reason!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ العكس غير صحيح' })
  reversalDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية للعكس' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ type: [ManufacturingReversalDecisionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManufacturingReversalDecisionDto)
  manufacturingDecisions?: ManufacturingReversalDecisionDto[];
}
