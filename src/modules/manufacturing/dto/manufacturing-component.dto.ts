import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';

/** One BOM component line on a manufacturing order (total quantity for the order). */
export class ManufacturingComponentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار منتج المكوّن' })
  componentProductId!: string;

  @ApiProperty({ minimum: 0.0001 })
  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً' })
  @Min(0.0001, { message: 'كمية المكوّن يجب أن تكون أكبر من صفر' })
  quantity!: number;
}
