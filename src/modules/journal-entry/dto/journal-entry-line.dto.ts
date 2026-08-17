import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** One line of a manual journal entry as sent from the client. */
export class JournalEntryLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار حساب صحيح' })
  accountId!: string;

  @ApiProperty({ default: 0 })
  @IsNumber({}, { message: 'قيمة المدين غير صحيحة' })
  @Min(0, { message: 'قيمة المدين لا يمكن أن تكون سالبة' })
  debit!: number;

  @ApiProperty({ default: 0 })
  @IsNumber({}, { message: 'قيمة الدائن غير صحيحة' })
  @Min(0, { message: 'قيمة الدائن لا يمكن أن تكون سالبة' })
  credit!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string | null;
}
