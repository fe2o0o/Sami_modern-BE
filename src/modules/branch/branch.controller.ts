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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BranchService } from './branch.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { QueryBranchDto } from './dto/query-branch.dto';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';

@ApiTags('Branches')
@ApiBearerAuth('access-token')
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @ResponseMessage(
    'تم إنشاء الفرع بنجاح، وتم إنشاء مخزن افتراضي لهذا الفرع تلقائيًا وتعيينه كمخزن افتراضي',
  )
  @ApiOperation({ summary: 'إضافة فرع (مع إنشاء مخزن افتراضي تلقائيًا)' })
  create(@Body() dto: CreateBranchDto) {
    return this.branchService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'عرض الفروع مع الترقيم' })
  findAll(@Query() query: QueryBranchDto) {
    return this.branchService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'عرض فرع' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchService.findOne(id);
  }

  @Put(':id')
  @ResponseMessage('تم حفظ البيانات بنجاح')
  @ApiOperation({ summary: 'تعديل فرع' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('تم حذف الفرع بنجاح')
  @ApiOperation({ summary: 'حذف فرع' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchService.remove(id);
  }
}
