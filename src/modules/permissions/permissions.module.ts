import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';

/**
 * Owns the permission catalog, the `role_permissions` store and the
 * {@link PermissionsService} used by the JWT strategy, the permissions guard and
 * the role module. The global {@link PermissionsGuard} itself is registered in
 * AuthModule so it runs right after the JWT guard.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RolePermission, Role])],
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
