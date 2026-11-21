import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManufacturingStageService } from './manufacturing-stage.service';
import { CreateManufacturingStageDto, StageProgressDto, UpdateManufacturingStageDto } from './dto/manufacturing-stage.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

/**
 * Internal manufacturing stages: the master list (مراحل التصنيع) and the
 * operations supervisor's progress on an order's stages.
 */
@ApiTags('Manufacturing stages')
@ApiBearerAuth('access-token')
@Controller('manufacturing')
export class ManufacturingStageController {
  constructor(private readonly service: ManufacturingStageService) {}

  // ── master list ──
  @Get('stages')
  @RequirePermissions('manufacturing_stages.view')
  @ApiOperation({ summary: 'مراحل التصنيع' })
  findAll(@Query('active') active?: string) {
    return this.service.findAll(active !== 'true');
  }

  @Post('stages')
  @RequirePermissions('manufacturing_stages.manage')
  @ResponseMessage('تم حفظ مرحلة التصنيع بنجاح')
  @ApiOperation({ summary: 'إضافة مرحلة تصنيع' })
  create(@Body() dto: CreateManufacturingStageDto) {
    return this.service.create(dto);
  }

  @Put('stages/:id')
  @RequirePermissions('manufacturing_stages.manage')
  @ResponseMessage('تم حفظ مرحلة التصنيع بنجاح')
  @ApiOperation({ summary: 'تعديل مرحلة تصنيع' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateManufacturingStageDto) {
    return this.service.update(id, dto);
  }

  @Delete('stages/:id')
  @RequirePermissions('manufacturing_stages.manage')
  @ResponseMessage('تم حذف مرحلة التصنيع بنجاح')
  @ApiOperation({ summary: 'حذف مرحلة تصنيع غير مستخدمة' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  // ── progress on an order (the operations supervisor) ──
  @Post('orders/:orderId/stages/:stageId/start')
  @RequirePermissions('production_progress.manage')
  @ResponseMessage('تم بدء المرحلة')
  @ApiOperation({ summary: 'بدء مرحلة إنتاج على أمر تصنيع' })
  start(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: StageProgressDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.start(orderId, stageId, dto.notes, actorId, branchScope);
  }

  @Post('orders/:orderId/stages/:stageId/complete')
  @RequirePermissions('production_progress.manage')
  @ResponseMessage('تم إنهاء المرحلة')
  @ApiOperation({ summary: 'إنهاء مرحلة إنتاج على أمر تصنيع' })
  complete(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: StageProgressDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.complete(orderId, stageId, dto.notes, actorId, branchScope);
  }

  @Post('orders/:orderId/stages/:stageId/undo')
  @RequirePermissions('production_progress.manage')
  @ResponseMessage('تم التراجع عن آخر تحديث للمرحلة')
  @ApiOperation({ summary: 'تراجع عن آخر تحديث لمرحلة' })
  undo(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: StageProgressDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.undo(orderId, stageId, dto.notes, actorId, branchScope);
  }
}
