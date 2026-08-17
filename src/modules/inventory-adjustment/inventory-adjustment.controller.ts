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

@ApiTags('Inventory Adjustments')
@ApiBearerAuth('access-token')
@Controller('inventory/adjustments')
export class InventoryAdjustmentController {
  constructor(
    private readonly service: InventoryAdjustmentService,
    private readonly posting: InventoryAdjustmentPostingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'عرض تسويات المخزون مع الترقيم والفلاتر' })
  findAll(@Query() query: InventoryAdjustmentQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل تسوية مخزون' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneDetailed(id);
  }

  @Post()
  @ResponseMessage('تم حفظ التسوية كمسودة بنجاح')
  @ApiOperation({ summary: 'إنشاء تسوية مخزون (مسودة)' })
  create(@Body() dto: CreateInventoryAdjustmentDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث التسوية بنجاح')
  @ApiOperation({ summary: 'تعديل تسوية (مسودة)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryAdjustmentDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف التسوية بنجاح')
  @ApiOperation({ summary: 'حذف تسوية (مسودة فقط)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }

  @Post(':id/post')
  @ResponseMessage('تم ترحيل التسوية بنجاح')
  @ApiOperation({ summary: 'ترحيل التسوية (مخزون + قيد)' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.posting.post(id, actorId);
  }

  @Post(':id/reverse')
  @ResponseMessage('تم عكس التسوية بنجاح')
  @ApiOperation({ summary: 'عكس تسوية مُرحّلة' })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseInventoryAdjustmentDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.posting.reverse(id, dto, actorId);
  }
}
