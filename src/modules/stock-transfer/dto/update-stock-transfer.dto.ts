import { PartialType } from '@nestjs/swagger';
import { CreateStockTransferDto } from './create-stock-transfer.dto';

export class UpdateStockTransferDto extends PartialType(CreateStockTransferDto) {}
