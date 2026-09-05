import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CodeSettingService } from './code-setting.service';
import { UpdateCodeSettingDto } from './dto/update-code-setting.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Code Settings')
@ApiBearerAuth('access-token')
@Controller('code-settings')
export class CodeSettingController {
  constructor(private readonly service: CodeSettingService) {}

  @Get()
  @RequirePermissions('code_settings.view')
  @ApiOperation({ summary: 'إعدادات توليد الأكواد لكل كيان' })
  findAll() {
    return this.service.findAll();
  }

  // Open to any authenticated user — the entity forms call it to preview/prefill.
  @Get(':entityKey/preview')
  @ApiOperation({ summary: 'معاينة الكود التالي لكيان (لا يستهلك العدّاد)' })
  preview(@Param('entityKey') entityKey: string) {
    return this.service.preview(entityKey);
  }

  @Put(':entityKey')
  @RequirePermissions('code_settings.edit')
  @ResponseMessage('تم تحديث إعداد الكود بنجاح')
  @ApiOperation({ summary: 'تعديل إعداد توليد كود كيان' })
  update(@Param('entityKey') entityKey: string, @Body() dto: UpdateCodeSettingDto) {
    return this.service.update(entityKey, dto);
  }
}
