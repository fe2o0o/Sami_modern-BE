import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

/** Cost price for a product that has no cost yet (set from the invoice). */
export class SetProductCostDto {
  @ApiProperty({ minimum: 0.01 })
  @IsNumber({}, { message: 'التكلفة يجب أن تكون رقماً' })
  @Min(0.01, { message: 'التكلفة يجب أن تكون أكبر من صفر' })
  costPrice!: number;
}
