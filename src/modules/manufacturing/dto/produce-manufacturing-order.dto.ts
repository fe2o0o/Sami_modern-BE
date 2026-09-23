import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { ManufacturingComponentDto } from './manufacturing-component.dto';

/**
 * Execute production of a manufacturing order: consume the components from a
 * warehouse and produce the finished product into it at (components + fee) cost.
 * An optional factory supplier makes the fee a payable to that supplier.
 */
export class ProduceManufacturingOrderDto {
  @ApiProperty({ format: 'uuid', description: 'المخزن الذي تُستهلك منه المكوّنات ويُنتج فيه المنتج' })
  @IsUUID('4', { message: 'يجب اختيار المخزن' })
  warehouseId!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString({}, { message: 'تاريخ الإنتاج غير صحيح' })
  productionDate!: string;

  @ApiPropertyOptional({ minimum: 0, description: 'رسوم التصنيع (مصنعية/عمالة)' })
  @IsOptional()
  @IsNumber({}, { message: 'رسوم التصنيع يجب أن تكون رقماً' })
  @Min(0, { message: 'رسوم التصنيع لا يمكن أن تكون سالبة' })
  manufacturingFee?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'مصنع (مورّد) خارجي — تُسجّل الرسوم كمديونية له' })
  @IsOptional()
  @IsUUID()
  factorySupplierId?: string | null;

  /** Optional override of the stored order components at production time. */
  @ApiPropertyOptional({ type: [ManufacturingComponentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManufacturingComponentDto)
  components?: ManufacturingComponentDto[];
}
