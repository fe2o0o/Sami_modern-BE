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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TreasuryService } from './treasury.service';
import { TreasuryLedgerService } from './treasury-ledger.service';
import { CreateTreasuryDto } from './dto/create-treasury.dto';
import { UpdateTreasuryDto } from './dto/update-treasury.dto';
import { QueryTreasuryDto } from './dto/query-treasury.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@ApiTags('Treasuries')
@ApiBearerAuth('access-token')
@Controller('treasuries')
export class TreasuryController {
  constructor(
    private readonly service: TreasuryService,
    private readonly ledger: TreasuryLedgerService,
  ) {}

  @Get('lookup')
  @RequirePermissions('treasuries.view')
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'قائمة الخزائن النشطة (اختياريًا حسب الفرع)' })
  lookup(@Query('branchId') branchId?: string) {
    return this.service.lookup(branchId);
  }

  @Get()
  @RequirePermissions('treasuries.view')
  @ApiOperation({ summary: 'عرض الخزائن مع الترقيم والفلاتر' })
  findAll(@Query() query: QueryTreasuryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('treasuries.view')
  @ApiOperation({ summary: 'عرض خزينة' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/statement')
  @RequirePermissions('treasuries.view')
  @ApiOperation({ summary: 'كشف حركة الخزينة والرصيد' })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.statement(id);
  }

  @Post()
  @RequirePermissions('treasuries.manage')
  @ResponseMessage('تم حفظ الخزينة بنجاح')
  @ApiOperation({ summary: 'إضافة خزينة' })
  create(@Body() dto: CreateTreasuryDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @RequirePermissions('treasuries.manage')
  @ResponseMessage('تم حفظ الخزينة بنجاح')
  @ApiOperation({ summary: 'تعديل خزينة' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTreasuryDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @RequirePermissions('treasuries.manage')
  @ResponseMessage('تم حذف الخزينة بنجاح')
  @ApiOperation({ summary: 'حذف خزينة' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }
}
