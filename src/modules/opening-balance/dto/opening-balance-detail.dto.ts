import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { OpeningBalanceReferenceType } from '../enums/opening-balance.enum';

/**
 * One opening-balance line. Only the fields relevant to `referenceType` need be
 * populated; cross-field/business validation (which id is required for which
 * type, debit-xor-credit, etc.) is enforced in the service so error messages
 * stay unified and Arabic.
 */
export class OpeningBalanceDetailDto {
  @ApiProperty({ enum: OpeningBalanceReferenceType })
  @IsEnum(OpeningBalanceReferenceType, { message: 'نوع السطر غير صالح' })
  referenceType!: OpeningBalanceReferenceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الحساب غير صالح' })
  accountId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف العميل غير صالح' })
  customerId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المورد غير صالح' })
  supplierId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المخزن غير صالح' })
  warehouseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف المنتج غير صالح' })
  productId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'الخزينة (لبنود النقدية)' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الخزينة غير صالح' })
  treasuryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'الحساب البنكي (لبنود البنوك)' })
  @IsOptional()
  @IsUUID('4', { message: 'معرّف الحساب البنكي غير صالح' })
  bankAccountId?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0, { message: 'الكمية يجب ألا تكون سالبة' })
  quantity?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'تكلفة الوحدة يجب أن تكون رقماً' })
  @Min(0, { message: 'تكلفة الوحدة يجب ألا تكون سالبة' })
  unitCost?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'المدين يجب أن يكون رقماً' })
  @Min(0, { message: 'المدين يجب ألا يكون سالباً' })
  debit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'الدائن يجب أن يكون رقماً' })
  @Min(0, { message: 'الدائن يجب ألا يكون سالباً' })
  credit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  @MaxLength(500, { message: 'الملاحظات يجب ألا تتجاوز 500 حرف' })
  notes?: string | null;
}
