import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSalesDeliveryDto } from './create-sales-delivery.dto';

/** Source + linked invoice are fixed after creation. */
export class UpdateSalesDeliveryDto extends PartialType(
  OmitType(CreateSalesDeliveryDto, ['source', 'salesInvoiceId'] as const),
) {}
