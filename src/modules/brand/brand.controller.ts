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
import { BrandService } from './brand.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Brands')
@ApiBearerAuth('access-token')
@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @RequirePermissions('product_catalog.manage')
  @ResponseMessage('تم حفظ العلامة التجارية بنجاح')
  @ApiOperation({ summary: 'إضافة علامة تجارية' })
  create(@Body() dto: CreateBrandDto) {
    return this.brandService.create(dto);
  }

  @Get()
  @RequirePermissions('product_catalog.view')
  @ApiOperation({ summary: 'عرض العلامات التجارية مع الترقيم' })
  findAll(@Query() query: StatusQueryDto) {
    return this.brandService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('product_catalog.view')
  @ApiOperation({ summary: 'عرض علامة تجارية' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('product_catalog.manage')
  @ResponseMessage('تم حفظ العلامة التجارية بنجاح')
  @ApiOperation({ summary: 'تعديل علامة تجارية' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    return this.brandService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('product_catalog.manage')
  @ResponseMessage('تم حذف العلامة التجارية بنجاح')
  @ApiOperation({ summary: 'حذف علامة تجارية' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandService.remove(id);
  }

  @Patch(':id/restore')
  @RequirePermissions('product_catalog.manage')
  @ResponseMessage('تم استعادة العلامة التجارية بنجاح')
  @ApiOperation({ summary: 'استعادة علامة محذوفة' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.brandService.restore(id);
  }
}
