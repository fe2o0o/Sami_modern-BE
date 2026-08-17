import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportRegistry } from './import.registry';
import { sendXlsx } from './excel-download.util';
import { EXCEL_UPLOAD_OPTIONS } from './excel-upload.options';
import { ResponseMessage } from '../decorators/response-message.decorator';
import type { UploadedExcel } from './excel.types';

/**
 * One controller serving EVERY entity's Excel import. `:resource` is a slug a
 * feature service registered in the {@link ImportRegistry} (e.g. 'units',
 * 'products', 'chart-of-accounts'). Adding import to a new entity needs no new
 * route — just a `register()` call in that service.
 */
@ApiTags('Excel Import')
@ApiBearerAuth('access-token')
@Controller('import')
export class ImportController {
  constructor(private readonly registry: ImportRegistry) {}

  @Get(':resource/template')
  @ApiOperation({ summary: 'تنزيل نموذج استيراد Excel للكيان' })
  async template(@Param('resource') resource: string, @Res() res: Response) {
    const importer = this.registry.get(resource);
    sendXlsx(res, await importer.template(), importer.templateFilename);
  }

  @Post(':resource')
  @ResponseMessage('تمت معالجة ملف الاستيراد')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'استيراد بيانات الكيان من ملف Excel' })
  @UseInterceptors(FileInterceptor('file', EXCEL_UPLOAD_OPTIONS))
  importRows(
    @Param('resource') resource: string,
    @UploadedFile() file: UploadedExcel,
  ) {
    return this.registry.get(resource).importRows(file);
  }
}
