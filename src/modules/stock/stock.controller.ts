import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';

@ApiTags('Stock')
@ApiBearerAuth('access-token')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiOperation({ summary: 'عرض أرصدة المخزون الحالية' })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.findAll(query, warehouseId);
  }

  @Get('movements')
  @ApiOperation({ summary: 'سجل حركات المخزون مع الفلاتر' })
  findMovements(@Query() query: StockMovementQueryDto) {
    return this.stockService.findMovements(query);
  }
}
