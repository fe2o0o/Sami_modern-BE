import { PartialType } from '@nestjs/swagger';
import { CreateChartOfAccountDto } from './create-chart-of-account.dto';

export class UpdateChartOfAccountDto extends PartialType(CreateChartOfAccountDto) {}
