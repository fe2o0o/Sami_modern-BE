import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { SalesDiscountType, SalesLineType } from '../enums/sales-invoice.enum';

/** One sales-invoice line as sent from the client (money is recomputed server-side). */
export class SalesInvoiceItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج' })
  productId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @ApiPropertyOptional({ enum: SalesLineType, default: SalesLineType.STOCK })
  @IsOptional()
  @IsEnum(SalesLineType)
  lineType?: SalesLineType;

  // ── Manufacturing spec (used when lineType = MANUFACTURING) ──
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ التسليم غير صحيح' })
  deliveryDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dimensions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  material?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specifications?: string | null;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber()
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0, { message: 'سعر الوحدة غير صحيح' })
  unitPrice!: number;

  @ApiPropertyOptional({ enum: SalesDiscountType, default: SalesDiscountType.FIXED })
  @IsOptional()
  @IsEnum(SalesDiscountType)
  discountType?: SalesDiscountType;

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
