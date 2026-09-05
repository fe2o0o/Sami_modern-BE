import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unit } from './entities/unit.entity';
import { UnitService } from './unit.service';
import { UnitController } from './unit.controller';
import { CodeSettingModule } from '../code-setting/code-setting.module';

@Module({
  imports: [TypeOrmModule.forFeature([Unit]), CodeSettingModule],
  controllers: [UnitController],
  providers: [UnitService],
  exports: [UnitService, TypeOrmModule],
})
export class UnitModule {}
