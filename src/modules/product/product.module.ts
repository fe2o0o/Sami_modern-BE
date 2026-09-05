import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductImage]), CodeSettingModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService, TypeOrmModule],
})
export class ProductModule {}
