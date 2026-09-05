import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from './entities/brand.entity';
import { BrandService } from './brand.service';
import { BrandController } from './brand.controller';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Brand]), CodeSettingModule],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService, TypeOrmModule],
})
export class BrandModule {}
