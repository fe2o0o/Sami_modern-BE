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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductCategoryService } from './product-category.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Product Categories')
@ApiBearerAuth('access-token')
@Controller('product-categories')
export class ProductCategoryController {
  constructor(private readonly categoryService: ProductCategoryService) {}

  @Post()
  @ResponseMessage('تم حفظ التصنيف بنجاح')
  @ApiOperation({ summary: 'إضافة تصنيف منتجات' })
  create(@Body() dto: CreateProductCategoryDto) {
    return this.categoryService.create(dto);
  }

  // NOTE: declared before ':id' so "tree" is not treated as an id.
  @Get()
  @ApiOperation({ summary: 'عرض شجرة التصنيفات' })
  tree() {
    return this.categoryService.tree();
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض تصنيف' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ التصنيف بنجاح')
  @ApiOperation({ summary: 'تعديل تصنيف' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.categoryService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف التصنيف بنجاح')
  @ApiOperation({ summary: 'حذف تصنيف' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة التصنيف بنجاح')
  @ApiOperation({ summary: 'استعادة تصنيف محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoryService.restore(id);
  }
}
