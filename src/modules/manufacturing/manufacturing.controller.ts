import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManufacturingService } from './manufacturing.service';
import { CreateManufacturingOrderDto } from './dto/create-manufacturing-order.dto';
import {
  UpdateManufacturingOrderDto,
  UpdateManufacturingStatusDto,
} from './dto/update-manufacturing-order.dto';
import { ManufacturingOrderQueryDto } from './dto/manufacturing-order-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Manufacturing')
@ApiBearerAuth('access-token')
@Controller('manufacturing/orders')
export class ManufacturingController {
  constructor(private readonly service: ManufacturingService) {}

  @Get()
  @RequirePermissions('manufacturing.view')
  @ApiOperation({ summary: 'عرض أوامر التصنيع مع الترقيم والفلاتر' })
  findAll(@Query() query: ManufacturingOrderQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.service.findAll(query, branchScope);
  }

  @Get(':id')
  @RequirePermissions('manufacturing.view')
  @ApiOperation({ summary: 'تفاصيل أمر تصنيع' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @BranchScope() branchScope: string[] | null) {
    return this.service.findOneDetailed(id, branchScope);
  }

  @Post()
  @RequirePermissions('manufacturing.create')
  @ResponseMessage('تم إنشاء أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'إنشاء أمر تصنيع (طلب إنتاج)' })
  create(
    @Body() dto: CreateManufacturingOrderDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.create(dto, actorId, branchScope);
  }

  @Put(':id')
  @RequirePermissions('manufacturing.edit')
  @ResponseMessage('تم تحديث أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'تعديل أمر تصنيع' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManufacturingOrderDto,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.update(id, dto, actorId, branchScope);
  }

  @Patch(':id/status')
  @RequirePermissions('manufacturing.edit')
  @ResponseMessage('تم تحديث حالة أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'تغيير حالة أمر التصنيع' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManufacturingStatusDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.setStatus(id, dto.status, actorId);
  }

  @Delete(':id')
  @RequirePermissions('manufacturing.delete')
  @ResponseMessage('تم حذف أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'حذف أمر تصنيع (جديد فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @BranchScope() branchScope: string[] | null,
  ) {
    return this.service.remove(id, actorId, branchScope);
  }
}
