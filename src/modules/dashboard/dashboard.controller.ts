import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import type { BranchScope as BranchScopeType } from '../../common/utils/branch-scope.util';

/**
 * Read-only analytics for the home dashboard. One endpoint per tab so the client
 * fetches only the active tab. Every figure is scoped to the caller's branches;
 * a `branchId` filter narrows further for multi-branch users. No permission is
 * required beyond being authenticated — the dashboard is visible to all users.
 */
@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('financial')
  @ApiOperation({ summary: 'مؤشرات مالية: مبيعات/مشتريات/نقدية/ذمم + تدفق نقدي' })
  financial(@Query() query: DashboardQueryDto, @BranchScope() scope: BranchScopeType) {
    return this.service.financial(query, scope);
  }

  @Get('sales')
  @ApiOperation({ summary: 'تحليلات المبيعات: اتجاه، أفضل منتجات/عملاء، تسليم' })
  sales(@Query() query: DashboardQueryDto, @BranchScope() scope: BranchScopeType) {
    return this.service.sales(query, scope);
  }

  @Get('purchases')
  @ApiOperation({ summary: 'تحليلات المشتريات: اتجاه، أفضل منتجات/موردين' })
  purchases(@Query() query: DashboardQueryDto, @BranchScope() scope: BranchScopeType) {
    return this.service.purchases(query, scope);
  }

  @Get('inventory')
  @ApiOperation({ summary: 'حالة المخزون: القيمة، النواقص، حسب المخزن، التصنيع' })
  inventory(@Query() query: DashboardQueryDto, @BranchScope() scope: BranchScopeType) {
    return this.service.inventory(query, scope);
  }
}
