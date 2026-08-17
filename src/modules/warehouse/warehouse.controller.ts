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
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Warehouses')
@ApiBearerAuth('access-token')
@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  @ResponseMessage('تم حفظ البيانات بنجاح')
  @ApiOperation({ summary: 'إضافة مخزن' })
  create(@Body() dto: CreateWarehouseDto) {
    return this.warehouseService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض المخازن مع الترقيم' })
  findAll(@Query() query: QueryWarehouseDto) {
    return this.warehouseService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض مخزن' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ البيانات بنجاح')
  @ApiOperation({ summary: 'تعديل مخزن' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehouseService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف المخزن بنجاح')
  @ApiOperation({ summary: 'حذف مخزن' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.remove(id);
  }
}
