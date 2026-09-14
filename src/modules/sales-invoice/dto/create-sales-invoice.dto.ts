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
import { SalesPaymentType } from '../enums/sales-invoice.enum';
import { SalesInvoiceItemDto } from './sales-invoice-item.dto';
import { SalesInvoiceCommissionDto } from './sales-invoice-commission.dto';

/** Create a sales invoice (always starts DRAFT — no stock/accounting effect). */
export class CreateSalesInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار العميل' })
  customerId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الفاتورة غير صحيح' })
  invoiceDate!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /** Representative header warehouse. Optional — the server derives it from the
   *  first stock line; each line carries its own warehouse. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'يجب اختيار المخزن' })
  warehouseId?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار السنة المالية' })
  fiscalYearId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفترة المحاسبية' })
  accountingPeriodId!: string;

  @ApiPropertyOptional({ enum: SalesPaymentType, default: SalesPaymentType.CREDIT })
  @IsOptional()
  @IsEnum(SalesPaymentType)
  paymentType?: SalesPaymentType;

  @ApiPropertyOptional({ format: 'uuid', description: 'حساب النقدية/البنك للبيع النقدي' })
  @IsOptional()
  @IsUUID()
  cashAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ type: [SalesInvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إضافة منتج واحد على الأقل' })
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceItemDto)
  items!: SalesInvoiceItemDto[];

  @ApiPropertyOptional({ type: [SalesInvoiceCommissionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceCommissionDto)
  commissions?: SalesInvoiceCommissionDto[];
}
