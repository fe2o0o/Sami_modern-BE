import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryAdjustmentPostingService } from './inventory-adjustment-posting.service';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { UpdateInventoryAdjustmentDto } from './dto/update-inventory-adjustment.dto';
import { InventoryAdjustmentQueryDto } from './dto/inventory-adjustment-query.dto';
import { ReverseInventoryAdjustmentDto } from './dto/reverse-inventory-adjustment.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Inventory Adjustments')
@ApiBearerAuth('access-token')
@Controller('inventory/adjustments')
export class InventoryAdjustmentController {
  constructor(
    private readonly service: InventoryAdjustmentService,
    private readonly posting: InventoryAdjustmentPostingService,
  ) {}

  @Get()
  @RequirePermissions('inventory_adjustments.view')
  @ApiOperation({ summary: 'عرض تسويات المخزون مع الترقيم والفلاتر' })
  findAll(@Query() query: InventoryAdjustmentQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('inventory_adjustments.view')
  @ApiOperation({ summary: 'تفاصيل تسوية مخزون' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('inventory_adjustments.create')
  @ResponseMessage('تم حفظ التسوية كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء تسوية مخزون (مسودة)' })
  create(
    @Body() dto: CreateInventoryAdjustmentDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('inventory_adjustments.edit')
  @ResponseMessage('تم تحديث التسوية بنجاح')
  @ApiOperation({ summary: 'تعديل تسوية (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryAdjustmentDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Delete(':id')
  @RequirePermissions('inventory_adjustments.delete')
  @ResponseMessage('تم حذف التسوية بنجاح')
  @ApiOperation({ summary: 'حذف تسوية (مسودة فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }

  @Post(':id/post')
  @RequirePermissions('inventory_adjustments.post')
  @ResponseMessage('تم ترحيل التسوية بنجاح')
  @ApiOperation({ summary: 'ترحيل التسوية (مخزون + قيد)' })
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.post(id, actorId, branchScope);
  }

  @Post(':id/reverse')
  @RequirePermissions('inventory_adjustments.reverse')
  @ResponseMessage('تم عكس التسوية بنجاح')
  @ApiOperation({ summary: 'عكس تسوية مُرحّلة' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseInventoryAdjustmentDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.posting.reverse(id, dto, actorId, branchScope);
  }
}
