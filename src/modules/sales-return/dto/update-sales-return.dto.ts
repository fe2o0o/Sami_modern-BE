import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSalesReturnDto } from './create-sales-return.dto';

/** Edit a DRAFT sales return. The original invoice is fixed after creation. */
export class UpdateSalesReturnDto extends PartialType(OmitType(CreateSalesReturnDto, ['salesInvoiceId'] as const)) {}
