import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StockService } from './stock.service';
import { StockQueryDto } from './dto/stock-query.dto';
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
  @ApiOperation({ summary: 'عرض أرصدة المخزون الحالية' })
  findAll(@Query() query: StockQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.stockService.findAll(query, query.warehouseId, branchScope);
  }

  @Get('movements')
  @RequirePermissions('stock.view')
  @ApiOperation({ summary: 'سجل حركات المخزون مع الفلاتر' })
  findMovements(@Query() query: StockMovementQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.stockService.findMovements(query, branchScope);
  }

  @Get('costs')
  @RequirePermissions('stock.view')
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({ name: 'productType', required: false })
  @ApiOperation({ summary: 'متوسط تكلفة والرصيد لكل منتج في مخزن (للتصنيع)' })
  costs(
    @Query('warehouseId') warehouseId: string,
    @BranchScope() branchScope: string[] | null,
    @Query('productType') productType?: string,
  ) {
    return this.stockService.costs(warehouseId, branchScope, productType);
  }
}
