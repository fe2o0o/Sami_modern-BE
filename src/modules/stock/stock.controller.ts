import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';

@ApiTags('Stock')
@ApiBearerAuth('access-token')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @RequirePermissions('stock.view')
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiOperation({ summary: 'عرض أرصدة المخزون الحالية' })
  findAll(
    @Query() query: PaginationQueryDto,
    @BranchScope() branchScope: string | null,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.stockService.findAll(query, warehouseId, branchScope);
  }

  @Get('movements')
  @RequirePermissions('stock.view')
  @ApiOperation({ summary: 'سجل حركات المخزون مع الفلاتر' })
  findMovements(@Query() query: StockMovementQueryDto, @BranchScope() branchScope: string | null) {
    return this.stockService.findMovements(query, branchScope);
  }
}
