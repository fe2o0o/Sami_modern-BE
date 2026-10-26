import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { EmployeeHrService, MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES } from './employee-hr.service';
import type { StoredFile, UploadedHrFile } from './employee-hr.service';
import { SalaryService } from './salary.service';
import { ChangeEmployeeStatusDto, UploadEmployeeDocumentDto } from './dto/employee-hr.dto';
import { CreateSalaryPackageDto } from './dto/salary.dto';

/** Stream a private file inline (preview in the browser) with a UTF-8 file name. */
function sendStored(res: Response, file: StoredFile): void {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(file.path);
}

/** Per-employee HR actions: status lifecycle, documents, photo and salary packages. */
@ApiTags('Employees')
@ApiBearerAuth('access-token')
@Controller('employees/:id')
export class EmployeeHrController {
  constructor(
    private readonly hr: EmployeeHrService,
    private readonly salary: SalaryService,
  ) {}

  // ── status ──
  @Post('status')
  @RequirePermissions('employees.edit')
  @ResponseMessage('تم تغيير حالة الموظف')
  @ApiOperation({ summary: 'تغيير حالة الموظف (نشط / إجازة / مستقيل / منتهي خدمته) بتاريخ وسبب' })
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeEmployeeStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hr.changeStatus(id, dto, user?.userId);
  }

  @Get('status-history')
  @RequirePermissions('employees.view')
  statusHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.statusHistory(id);
  }

  // ── documents ──
  @Get('documents')
  @RequirePermissions('hr_documents.view')
  listDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.listDocuments(id);
  }

  @Post('documents')
  @RequirePermissions('hr_documents.manage')
  @ResponseMessage('تم رفع المستند بنجاح')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'رفع مستند للموظف (PDF / صورة، حد أقصى 10 ميجابايت)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedHrFile,
    @Body() dto: UploadEmployeeDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hr.uploadDocument(id, file, dto, user?.userId);
  }

  @Get('documents/:documentId/file')
  @RequirePermissions('hr_documents.view')
  async documentFile(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    sendStored(res, await this.hr.documentFile(id, documentId));
  }

  @Delete('documents/:documentId')
  @RequirePermissions('hr_documents.manage')
  @ResponseMessage('تم حذف المستند')
  removeDocument(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.hr.removeDocument(id, documentId);
  }

  // ── photo ──
  @Post('photo')
  @RequirePermissions('employees.edit')
  @ResponseMessage('تم حفظ صورة الموظف')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  uploadPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedHrFile) {
    if (!file) throw new BadRequestException('اختر صورة الموظف');
    return this.hr.uploadPhoto(id, file);
  }

  @Get('photo')
  @RequirePermissions('employees.view')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendStored(res, await this.hr.photoFile(id));
  }

  @Delete('photo')
  @RequirePermissions('employees.edit')
  @ResponseMessage('تم حذف صورة الموظف')
  removePhoto(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.removePhoto(id);
  }

  // ── salary packages ──
  @Get('salary')
  @RequirePermissions('hr_salary.view')
  @ApiOperation({ summary: 'رواتب الموظف (الحالي والقادم والسابق)' })
  salaryPackages(@Param('id', ParseUUIDPipe) id: string) {
    return this.salary.employeePackages(id);
  }

  @Post('salary')
  @RequirePermissions('hr_salary.manage')
  @ResponseMessage('تم حفظ الراتب بنجاح')
  @ApiOperation({ summary: 'راتب جديد للموظف بتاريخ سريان (الزيادة = راتب جديد، والقديم يبقى في السجل)' })
  createPackage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSalaryPackageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.salary.createPackage(id, dto, user?.userId);
  }

  @Delete('salary/:packageId')
  @RequirePermissions('hr_salary.manage')
  @ResponseMessage('تم حذف الراتب')
  removePackage(@Param('id', ParseUUIDPipe) id: string, @Param('packageId', ParseUUIDPipe) packageId: string) {
    return this.salary.removePackage(id, packageId);
  }
}
