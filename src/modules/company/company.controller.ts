import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

/**
 * Company endpoints — single record only (no create/delete/list).
 */
@ApiTags('Company')
@ApiBearerAuth('access-token')
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @ApiOperation({ summary: 'عرض بيانات الشركة' })
  get() {
    return this.companyService.get();
  }

  @Put()
  @ResponseMessage('تم حفظ البيانات بنجاح')
  @ApiOperation({ summary: 'تعديل بيانات الشركة' })
  update(@Body() dto: UpdateCompanyDto) {
    return this.companyService.update(dto);
  }
}
