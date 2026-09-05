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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequirePermissions('users.create')
  @ResponseMessage('تم إنشاء المستخدم بنجاح')
  @ApiOperation({ summary: 'إضافة مستخدم' })
  create(@Body() dto: CreateUserDto, @CurrentUser('userId') actorId: string) {
    return this.userService.create(dto, actorId);
  }

  @Get()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'عرض المستخدمين مع الترقيم' })
  findAll(@Query() query: QueryUserDto) {
    return this.userService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'عرض مستخدم' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('users.edit')
  @ResponseMessage('تم تعديل المستخدم بنجاح')
  @ApiOperation({ summary: 'تعديل مستخدم' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.userService.update(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  @ResponseMessage('تم حذف المستخدم بنجاح')
  @ApiOperation({ summary: 'حذف مستخدم' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.userService.remove(id, actorId);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users.edit')
  @ResponseMessage('تم إعادة تعيين كلمة المرور')
  @ApiOperation({ summary: 'إعادة تعيين كلمة مرور المستخدم (المدير)' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.userService.resetPassword(id, dto, actorId);
  }

  @Patch(':id/toggle-lock')
  @RequirePermissions('users.edit')
  @ResponseMessage('تم تحديث حالة القفل')
  @ApiOperation({ summary: 'قفل / إلغاء قفل المستخدم' })
  toggleLock(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.toggleLock(id);
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('users.edit')
  @ResponseMessage('تم تحديث حالة التفعيل')
  @ApiOperation({ summary: 'تفعيل / تعطيل المستخدم' })
  toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.toggleActive(id);
  }
}
