import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsUUID, Min } from 'class-validator';
import { SalesCommissionType } from '../enums/sales-invoice.enum';

/** One employee commission line on a sales invoice. */
export class SalesInvoiceCommissionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الموظف' })
  employeeId!: string;

  @ApiProperty({ enum: SalesCommissionType })
  @IsEnum(SalesCommissionType, { message: 'نوع العمولة غير صحيح' })
  commissionType!: SalesCommissionType;

  @ApiProperty({ minimum: 0, description: 'نسبة % أو مبلغ ثابت' })
  @IsNumber({}, { message: 'قيمة العمولة يجب أن تكون رقماً' })
  @Min(0, { message: 'قيمة العمولة يجب ألا تكون سالبة' })
  value!: number;
}
