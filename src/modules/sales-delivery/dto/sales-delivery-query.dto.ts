import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SalesDeliveryStatus } from '../enums/sales-delivery.enum';

export class SalesDeliveryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  salesInvoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  fiscalYearId?: string;

  @ApiPropertyOptional({ enum: SalesDeliveryStatus })
  @IsOptional()
  @IsEnum(SalesDeliveryStatus)
  status?: SalesDeliveryStatus;

  /**
   * The status shown in the list: delivery progress for invoice-based notes
   * (pending/partial/delivered, excluding reversed), document status for
   * standalone notes (draft/posted), and reversed for any note.
   */
  @ApiPropertyOptional({ enum: ['pending', 'partial', 'delivered', 'draft', 'posted', 'reversed'] })
  @IsOptional()
  @IsIn(['pending', 'partial', 'delivered', 'draft', 'posted', 'reversed'], { message: 'حالة إذن التسليم غير صالحة' })
  state?: 'pending' | 'partial' | 'delivered' | 'draft' | 'posted' | 'reversed';

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  dateTo?: string;
}
