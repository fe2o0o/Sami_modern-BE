import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  dateTo?: string;
}
