import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';
import { User } from '../user/entities/user.entity';
import { RoleService } from './role.service';
import { RoleController } from './role.controller';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [TypeOrmModule.forFeature([Role, User]), PermissionsModule],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [TypeOrmModule, RoleService],
})
export class RoleModule {}
