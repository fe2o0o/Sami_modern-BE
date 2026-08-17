import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  VoucherPaymentMethod,
  VoucherStatus,
  VoucherType,
} from '../enums/voucher.enum';

/** Filters for the voucher list. */
export class VoucherQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VoucherType })
  @IsOptional()
  @IsEnum(VoucherType)
  type?: VoucherType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional({ enum: VoucherPaymentMethod })
  @IsOptional()
  @IsEnum(VoucherPaymentMethod)
  paymentMethod?: VoucherPaymentMethod;

  @ApiPropertyOptional({ enum: VoucherStatus })
  @IsOptional()
  @IsEnum(VoucherStatus)
  status?: VoucherStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fiscalYearId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
