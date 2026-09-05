import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodeSetting } from './entities/code-setting.entity';
import { CodeSettingService } from './code-setting.service';
import { CodeSettingController } from './code-setting.controller';

/**
 * Per-entity code-generation settings. Exports {@link CodeSettingService} so
 * master-data modules can resolve/assign a record's `code` on create.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CodeSetting])],
  controllers: [CodeSettingController],
  providers: [CodeSettingService],
  exports: [CodeSettingService],
})
export class CodeSettingModule {}
