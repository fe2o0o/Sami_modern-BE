import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AccountType } from '../enums/account.enum';

export class QueryChartOfAccountDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AccountType, description: 'تصفية حسب نوع الحساب' })
  @IsOptional()
  @IsEnum(AccountType, { message: 'نوع الحساب غير صحيح' })
  accountType?: AccountType;

  @ApiPropertyOptional({ description: 'حسابات الترحيل فقط' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  allowPosting?: boolean;

  @ApiPropertyOptional({ description: 'الحسابات النشطة فقط' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
