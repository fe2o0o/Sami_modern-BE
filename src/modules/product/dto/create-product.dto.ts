import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ProductType } from '../enums/product-type.enum';

export class CreateProductDto {
  // ── Basic ──
  @ApiPropertyOptional({ example: 'PRD-0001', description: 'اختياري عند تفعيل التوليد التلقائي' })
  @IsOptional()
  @IsString({ message: 'كود المنتج غير صحيح' })
  @MaxLength(50, { message: 'الكود يجب ألا يتجاوز 50 حرفاً' })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الباركود يجب أن يكون نصاً' })
  @MaxLength(100)
  barcode?: string;

  @ApiProperty({ example: 'سرير مزدوج' })
  @IsString({ message: 'اسم المنتج مطلوب' })
  @MaxLength(255, { message: 'الاسم يجب ألا يتجاوز 255 حرفاً' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الاسم بالإنجليزية يجب أن يكون نصاً' })
  @MaxLength(255)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصاً' })
  description?: string;

  // ── Classification ──
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'التصنيف غير صالح' })
  categoryId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'العلامة التجارية غير صالحة' })
  brandId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'الوحدة غير صالحة' })
  unitId?: string | null;

  // ── Type ──
  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType, { message: 'نوع المنتج غير صالح' })
  productType!: ProductType;

  // ── Inventory ──
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'تتبع المخزون يجب أن يكون قيمة منطقية' })
  trackInventory?: boolean;

  @ApiPropertyOptional({ default: false, description: 'منتج مُصنّع داخلياً (له قائمة مكونات)' })
  @IsOptional()
  @IsBoolean({ message: 'قيمة التصنيع يجب أن تكون منطقية' })
  isManufactured?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'الحد الأدنى يجب أن يكون رقماً' })
  @Min(0, { message: 'الحد الأدنى يجب ألا يكون سالباً' })
  minQuantity?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'الحد الأقصى يجب أن يكون رقماً' })
  @Min(0, { message: 'الحد الأقصى يجب ألا يكون سالباً' })
  maxQuantity?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'حد إعادة الطلب يجب أن يكون رقماً' })
  @Min(0, { message: 'حد إعادة الطلب يجب ألا يكون سالباً' })
  reorderPoint?: number;

  // ── Pricing ──
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'سعر التكلفة يجب أن يكون رقماً' })
  @Min(0, { message: 'سعر التكلفة يجب ألا يكون سالباً' })
  costPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'سعر البيع يجب أن يكون رقماً' })
  @Min(0, { message: 'سعر البيع يجب ألا يكون سالباً' })
  sellingPrice?: number;

  // ── Accounting overrides ──
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'حساب المخزون غير صالح' })
  inventoryAccountId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'حساب تكلفة البضاعة غير صالح' })
  cogsAccountId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'حساب المبيعات غير صالح' })
  salesAccountId?: string | null;

  // ── Status ──
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'الحالة يجب أن تكون قيمة منطقية' })
  isActive?: boolean;
}
