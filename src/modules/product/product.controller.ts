import {
  BadRequestException,
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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProductService, UploadedImage } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { ReorderImagesDto } from './dto/reorder-images.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/** Reject non-image uploads before they hit the handler. */
function imageFileFilter(
  _req: unknown,
  file: { mimetype: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestException('صيغة الصورة غير مدعومة (JPG / PNG / WEBP فقط)'), false);
  }
}

@ApiTags('Products')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @ResponseMessage('تم حفظ المنتج بنجاح')
  @ApiOperation({ summary: 'إضافة منتج' })
  create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض المنتجات مع الترقيم' })
  findAll(@Query() query: QueryProductDto) {
    return this.productService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض تفاصيل منتج' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ المنتج بنجاح')
  @ApiOperation({ summary: 'تعديل منتج' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف المنتج بنجاح')
  @ApiOperation({ summary: 'حذف منتج' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة المنتج بنجاح')
  @ApiOperation({ summary: 'استعادة منتج محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.restore(id);
  }

  // =========================
  // IMAGES
  // =========================
  @Post(':id/images')
  @ResponseMessage('تم رفع الصور بنجاح')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'رفع صور المنتج (JPG/PNG/WEBP، حد أقصى 10 ميجابايت)' })
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  uploadImages(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.productService.addImages(id, files);
  }

  @Patch(':id/images/reorder')
  @ResponseMessage('تم إعادة ترتيب الصور بنجاح')
  @ApiOperation({ summary: 'إعادة ترتيب صور المنتج' })
  reorderImages(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.productService.reorderImages(id, dto.imageIds);
  }

  @Patch(':id/images/:imageId/primary')
  @ResponseMessage('تم تعيين الصورة الرئيسية بنجاح')
  @ApiOperation({ summary: 'تعيين صورة رئيسية للمنتج' })
  setPrimary(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productService.setPrimary(id, imageId);
  }

  @Delete(':id/images/:imageId')
  @ResponseMessage('تم حذف الصورة بنجاح')
  @ApiOperation({ summary: 'حذف صورة منتج' })
  deleteImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.productService.deleteImage(id, imageId);
  }
}
