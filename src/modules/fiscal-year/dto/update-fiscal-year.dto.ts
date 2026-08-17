import { PartialType } from '@nestjs/swagger';
import { CreateFiscalYearDto } from './create-fiscal-year.dto';

export class UpdateFiscalYearDto extends PartialType(CreateFiscalYearDto) {}
