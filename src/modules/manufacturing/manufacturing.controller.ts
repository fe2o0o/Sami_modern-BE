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

@ApiTags('Manufacturing')
@ApiBearerAuth('access-token')
@Controller('manufacturing/orders')
export class ManufacturingController {
  constructor(private readonly service: ManufacturingService) {}

  @Get()
  @ApiOperation({ summary: 'عرض أوامر التصنيع مع الترقيم والفلاتر' })
  findAll(@Query() query: ManufacturingOrderQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل أمر تصنيع' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneDetailed(id);
  }

  @Post()
  @ResponseMessage('تم إنشاء أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'إنشاء أمر تصنيع (طلب إنتاج)' })
  create(
    @Body() dto: CreateManufacturingOrderDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم تحديث أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'تعديل أمر تصنيع' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManufacturingOrderDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Patch(':id/status')
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
  @ResponseMessage('تم حذف أمر التصنيع بنجاح')
  @ApiOperation({ summary: 'حذف أمر تصنيع (جديد فقط)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.remove(id, actorId);
  }
}
