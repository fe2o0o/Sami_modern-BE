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
import { UnitService } from './unit.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Units')
@ApiBearerAuth('access-token')
@Controller('units')
export class UnitController {
  constructor(private readonly unitService: UnitService) {}

  @Post()
  @ResponseMessage('تم حفظ الوحدة بنجاح')
  @ApiOperation({ summary: 'إضافة وحدة قياس' })
  create(@Body() dto: CreateUnitDto) {
    return this.unitService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض وحدات القياس مع الترقيم' })
  findAll(@Query() query: StatusQueryDto) {
    return this.unitService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض وحدة قياس' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ الوحدة بنجاح')
  @ApiOperation({ summary: 'تعديل وحدة قياس' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    return this.unitService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف الوحدة بنجاح')
  @ApiOperation({ summary: 'حذف وحدة قياس' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة الوحدة بنجاح')
  @ApiOperation({ summary: 'استعادة وحدة محذوفة' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitService.restore(id);
  }
}
