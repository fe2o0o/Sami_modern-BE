import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import {
  PERMISSION_ACTION_LABELS,
  PERMISSION_CATALOG,
} from './permission.catalog';

@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@Controller('permissions')
export class PermissionsController {
  @Get('catalog')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'كتالوج الصلاحيات المتاحة (لبناء مصفوفة الأدوار)' })
  catalog() {
    return { groups: PERMISSION_CATALOG, actionLabels: PERMISSION_ACTION_LABELS };
  }

  @Get('me')
  @ApiOperation({ summary: 'صلاحيات المستخدم الحالي' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return {
      roleCode: user.roleCode,
      isSuperAdmin: user.isSuperAdmin,
      permissions: user.permissions,
    };
  }
}
