import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PurchaseDiscountType } from '../enums/purchase-invoice.enum';

/** One purchase-invoice line as sent from the client (money is recomputed server-side). */
export class PurchaseInvoiceItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج' })
  productId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber()
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiProperty({ minimum: 0, description: 'سعر شراء الوحدة' })
  @IsNumber()
  @Min(0, { message: 'سعر الوحدة غير صحيح' })
  unitPrice!: number;

  @ApiPropertyOptional({ enum: PurchaseDiscountType, default: PurchaseDiscountType.FIXED })
  @IsOptional()
  @IsEnum(PurchaseDiscountType)
  discountType?: PurchaseDiscountType;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ default: 0, description: 'نسبة الضريبة %' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  vatRate?: number;

  /** Buy the line straight onto this manufacturing order (raw material / semi-finished
   *  only): it never enters the warehouse and its net cost goes onto the order. */
  @ApiPropertyOptional({ format: 'uuid', description: 'أمر التصنيع (شراء مباشر على الأمر)' })
  @IsOptional()
  @IsUUID(undefined, { message: 'أمر التصنيع غير صحيح' })
  manufacturingOrderId?: string | null;

  /** What exactly was bought for the customer (e.g. «قطيفة كحلي»). */
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  directDescription?: string | null;
}
