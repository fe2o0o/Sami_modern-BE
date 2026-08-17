import { PartialType } from '@nestjs/swagger';
import { CreatePurchaseInvoiceDto } from './create-purchase-invoice.dto';

/** Edit a DRAFT purchase invoice (full replace of header + items). */
export class UpdatePurchaseInvoiceDto extends PartialType(CreatePurchaseInvoiceDto) {}
