import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PurchasePaymentType } from '../enums/purchase-invoice.enum';
import { PurchaseInvoiceItemDto } from './purchase-invoice-item.dto';

/** Create a purchase invoice (always starts DRAFT — no stock/accounting effect). */
export class CreatePurchaseInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المورّد' })
  supplierId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الفاتورة غير صحيح' })
  invoiceDate!: string;

  @ApiPropertyOptional({ description: 'رقم فاتورة المورّد (المرجع الورقي)' })
  @IsOptional()
  @IsString()
  supplierInvoiceNumber?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار المخزن' })
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ enum: PurchasePaymentType, default: PurchasePaymentType.CREDIT })
  @IsOptional()
  @IsEnum(PurchasePaymentType)
  paymentType?: PurchasePaymentType;

  @ApiPropertyOptional({ format: 'uuid', description: 'حساب النقدية/البنك للشراء النقدي' })
  @IsOptional()
  @IsUUID()
  cashAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [PurchaseInvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة منتج واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseInvoiceItemDto)
  items!: PurchaseInvoiceItemDto[];
}
