import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountingSettingService } from './accounting-setting.service';
import { UpdateAccountingSettingDto } from './dto/update-accounting-setting.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

/**
 * Accounting settings endpoints — single record only (no create/delete/list).
 */
@ApiTags('Accounting Settings')
@ApiBearerAuth('access-token')
@Controller('accounting-settings')
export class AccountingSettingController {
  constructor(
    private readonly accountingSettingService: AccountingSettingService,
  ) {}

  @Get()
  @RequirePermissions('accounting_settings.view')
  @ApiOperation({ summary: 'عرض إعدادات المحاسبة' })
  get() {
    return this.accountingSettingService.get();
  }

  @Get('account-options')
  @RequirePermissions('accounting_settings.view')
  @ApiOperation({
    summary: 'الحسابات الصالحة لكل إعداد (مصفّاة حسب النوع والتصنيف)',
  })
  accountOptions() {
    return this.accountingSettingService.accountOptions();
  }

  @Put()
  @RequirePermissions('accounting_settings.edit')
  @ResponseMessage('تم حفظ إعدادات المحاسبة بنجاح')
  @ApiOperation({ summary: 'تعديل إعدادات المحاسبة' })
  update(@Body() dto: UpdateAccountingSettingDto) {
    return this.accountingSettingService.update(dto);
  }
}
