import { PartialType } from '@nestjs/swagger';
import { CreateSalesInvoiceDto } from './create-sales-invoice.dto';

/** Edit a DRAFT sales invoice (full replace of header + items). */
export class UpdateSalesInvoiceDto extends PartialType(CreateSalesInvoiceDto) {}
