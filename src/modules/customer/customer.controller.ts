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
import { CustomerService } from './customer.service';
import { CustomerLedgerService } from './customer-ledger.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { StatusQueryDto } from '../../common/dto/status-query.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly ledgerService: CustomerLedgerService,
  ) {}

  @Post()
  @ResponseMessage('تم حفظ العميل بنجاح')
  @ApiOperation({ summary: 'إضافة عميل' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض العملاء مع الترقيم' })
  findAll(@Query() query: StatusQueryDto) {
    return this.customerService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض عميل' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customerService.findOne(id);
  }

  @Get(':id/statement')
  @ApiOperation({ summary: 'كشف حساب العميل (الحركات والرصيد)' })
  statement(@Param('id', ParseUUIDPipe) id: string) {
    return this.ledgerService.statement(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ العميل بنجاح')
  @ApiOperation({ summary: 'تعديل عميل' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف العميل بنجاح')
  @ApiOperation({ summary: 'حذف عميل' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.customerService.remove(id);
  }

  @Patch(':id/restore')
  @ResponseMessage('تم استعادة العميل بنجاح')
  @ApiOperation({ summary: 'استعادة عميل محذوف' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.customerService.restore(id);
  }
}
