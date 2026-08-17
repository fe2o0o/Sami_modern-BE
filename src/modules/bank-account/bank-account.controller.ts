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
import { BankAccountService } from './bank-account.service';
import { BankLedgerService } from './bank-ledger.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Bank Accounts')
@ApiBearerAuth('access-token')
@Controller('bank-accounts')
export class BankAccountController {
  constructor(
    private readonly service: BankAccountService,
    private readonly ledger: BankLedgerService,
  ) {}

  @Get('lookup')
  @ApiQuery({ name: 'branchId', required: false })
  @ApiOperation({ summary: 'قائمة الحسابات البنكية النشطة (اختياريًا حسب الفرع)' })
  lookup(@Query('branchId') branchId?: string) {
    return this.service.lookup(branchId);
  }

  @Get()
  @ApiOperation({ summary: 'عرض الحسابات البنكية مع الترقيم والفلاتر' })
  findAll(@Query() query: QueryBankAccountDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض حساب بنكي' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'كشف حركة الحساب البنكي والرصيد' })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.statement(id);
  }

  @Post()
  @ResponseMessage('تم حفظ الحساب البنكي بنجاح')
  @ApiOperation({ summary: 'إضافة حساب بنكي' })
  create(@Body() dto: CreateBankAccountDto, @CurrentUser('userId') actorId: string) {
    return this.service.create(dto, actorId);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ الحساب البنكي بنجاح')
  @ApiOperation({ summary: 'تعديل حساب بنكي' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser('userId') actorId: string,
  ) {
    return this.service.update(id, dto, actorId);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف الحساب البنكي بنجاح')
  @ApiOperation({ summary: 'حذف حساب بنكي' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') actorId: string) {
    return this.service.remove(id, actorId);
  }
}
