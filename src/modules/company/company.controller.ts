import { Body, Controller, Delete, Get, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompanyService, MAX_LOGO_BYTES } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

/**
 * Company endpoints — single record only (no create/delete/list).
 */
@ApiTags('Company')
@ApiBearerAuth('access-token')
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /** Company Profile for display — any signed-in user (header, printed documents, currency). */
  @Get('profile')
  @ApiOperation({ summary: 'ملف الشركة للعرض (الاسم والشعار والعملة والإعدادات العامة)' })
  profile() {
    return this.companyService.profile();
  }

  @Post('logo')
  @RequirePermissions('company.edit')
  @ResponseMessage('تم حفظ الشعار')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  uploadLogo(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number }) {
    return this.companyService.uploadLogo(file);
  }

  @Delete('logo')
  @RequirePermissions('company.edit')
  @ResponseMessage('تم حذف الشعار')
  removeLogo() {
    return this.companyService.removeLogo();
  }

  @Get()
  @RequirePermissions('company.view')
  @ApiOperation({ summary: 'عرض بيانات الشركة' })
  get() {
    return this.companyService.get();
  }

  @Put()
  @RequirePermissions('company.edit')
  @ResponseMessage('تم حفظ البيانات بنجاح')
  @ApiOperation({ summary: 'تعديل بيانات الشركة' })
  update(@Body() dto: UpdateCompanyDto) {
    return this.companyService.update(dto);
  }
}
