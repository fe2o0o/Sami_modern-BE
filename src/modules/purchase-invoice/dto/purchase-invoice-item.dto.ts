import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
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
}
