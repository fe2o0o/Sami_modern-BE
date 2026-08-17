import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateVoucherDto } from './create-voucher.dto';

/** Edit a DRAFT voucher. Type is fixed after creation. */
export class UpdateVoucherDto extends PartialType(OmitType(CreateVoucherDto, ['type'] as const)) {}
