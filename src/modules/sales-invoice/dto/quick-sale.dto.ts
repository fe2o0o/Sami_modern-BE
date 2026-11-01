import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SalesDiscountType } from '../enums/sales-invoice.enum';
import { SalesInvoiceCommissionDto } from './sales-invoice-commission.dto';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class QuickSaleItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'الصنف غير صحيح' })
  productId!: string;

  @ApiProperty({ minimum: 0.001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({}, { message: 'السعر يجب أن يكون رقماً' })
  @Min(0, { message: 'السعر لا يمكن أن يكون سالباً' })
  unitPrice!: number;

  @ApiPropertyOptional({ enum: SalesDiscountType })
  @IsOptional()
  @IsEnum(SalesDiscountType, { message: 'نوع الخصم غير صحيح' })
  discountType?: SalesDiscountType;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'الخصم يجب أن يكون رقماً' })
  @Min(0, { message: 'الخصم لا يمكن أن يكون سالباً' })
  discountValue?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'نسبة الضريبة يجب أن تكون رقماً' })
  @Min(0, { message: 'نسبة الضريبة لا يمكن أن تكون سالبة' })
  vatRate?: number;
}

/**
 * Quick sale (بيع سريع): a CASH sale from one warehouse to a walk-in customer who
 * is not registered — only their name (and mobile) are printed on the invoice.
 * Created and posted in one step; goods leave the warehouse immediately.
 */
export class QuickSaleDto {
  @ApiProperty({ description: 'اسم العميل كما يظهر على الفاتورة' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'اسم العميل مطلوب' })
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  @MaxLength(255, { message: 'اسم العميل طويل جداً' })
  customerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30, { message: 'رقم الموبايل طويل جداً' })
  customerMobile?: string | null;

  @ApiPropertyOptional({ format: 'date', description: 'الافتراضي: اليوم' })
  @IsOptional()
  @IsDateString({}, { message: 'التاريخ غير صحيح' })
  invoiceDate?: string;

  @ApiProperty({ format: 'uuid', description: 'المخزن الذي تخرج منه البضاعة' })
  @IsUUID(undefined, { message: 'اختر المخزن' })
  warehouseId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'حساب الخزنة / البنك (الافتراضي من إعدادات المحاسبة)' })
  @IsOptional()
  @IsUUID(undefined, { message: 'حساب التحصيل غير صحيح' })
  cashAccountId?: string | null;

  /** Sales commission lines — exactly as on a normal invoice (employee + percentage / fixed amount). */
  @ApiPropertyOptional({ type: [SalesInvoiceCommissionDto] })
  @IsOptional()
  @IsArray()
  @ArrayUnique((c: SalesInvoiceCommissionDto) => c?.employeeId, { message: 'الموظف مكرر في العمولات' })
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceCommissionDto)
  commissions?: SalesInvoiceCommissionDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [QuickSaleItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => QuickSaleItemDto)
  items!: QuickSaleItemDto[];
}
