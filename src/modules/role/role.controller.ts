import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@Controller('roles')
export class RoleController {
  constructor(private readonly service: RoleService) {}

  @Get()
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'عرض الأدوار' })
  findAll(@Query() query: QueryRoleDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'تفاصيل دور مع صلاحياته' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('roles.create')
  @ResponseMessage('تم إنشاء الدور بنجاح')
  @ApiOperation({ summary: 'إنشاء دور جديد' })
  create(@Body() dto: CreateRoleDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @RequirePermissions('roles.edit')
  @ResponseMessage('تم تعديل الدور بنجاح')
  @ApiOperation({ summary: 'تعديل دور وصلاحياته' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  @ResponseMessage('تم حذف الدور بنجاح')
  @ApiOperation({ summary: 'حذف دور (غير نظامي وبدون مستخدمين)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }
}
