import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { SalesDiscountType, SalesLineType } from '../enums/sales-invoice.enum';

/** One BOM component on a manufacturing line (quantity is PER UNIT of the product). */
export class SalesInvoiceItemComponentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج المكوّن' })
  componentProductId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'كمية المكوّن يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;
}

/** One sales-invoice line as sent from the client (money is recomputed server-side). */
export class SalesInvoiceItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج' })
  productId!: string;

  /** Warehouse this line is sold from (per-line). Falls back to the header. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'يجب اختيار المخزن' })
  warehouseId?: string | null;

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

  /** Per-order BOM for a MANUFACTURING line (does not change the product master). */
  @ApiPropertyOptional({ type: [SalesInvoiceItemComponentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceItemComponentDto)
  components?: SalesInvoiceItemComponentDto[];
}
