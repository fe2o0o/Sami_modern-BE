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
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Suppliers')
@ApiBearerAuth('access-token')
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @ResponseMessage('تم حفظ المورد بنجاح')
  @ApiOperation({ summary: 'إضافة مورد' })
  create(@Body() dto: CreateSupplierDto) {
    return this.supplierService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض الموردين مع الترقيم' })
  findAll(@Query() query: StatusQueryDto) {
    return this.supplierService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض مورد' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ المورد بنجاح')
  @ApiOperation({ summary: 'تعديل مورد' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.supplierService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف المورد بنجاح')
  @ApiOperation({ summary: 'حذف مورد' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة المورد بنجاح')
  @ApiOperation({ summary: 'استعادة مورد محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.supplierService.restore(id);
  }
}
