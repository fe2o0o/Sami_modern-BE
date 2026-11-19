import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CreateManufacturingOrderDto } from './create-manufacturing-order.dto';
import { ManufacturingOrderStatus } from '../enums/manufacturing.enum';

/** Edit an editable manufacturing order (NEW / IN_PROGRESS). */
export class UpdateManufacturingOrderDto extends PartialType(CreateManufacturingOrderDto) {}

/** Change a manufacturing order's status (new → in progress → done, or cancel). */
export class UpdateManufacturingStatusDto {
  @ApiProperty({ enum: ManufacturingOrderStatus })
  @IsEnum(ManufacturingOrderStatus, { message: 'حالة غير صحيحة' })
  status!: ManufacturingOrderStatus;

  /** Cancelling: warehouse for the raw material bought straight onto the order
   *  (default: each purchase invoice's own warehouse). */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'المخزن غير صحيح' })
  materialWarehouseId?: string | null;
}
