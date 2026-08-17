import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTreasuryDto {
  @ApiProperty({ example: 'TR-001' })
  @IsString({ message: 'كود الخزينة مطلوب' })
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'الخزينة الرئيسية' })
  @IsString({ message: 'اسم الخزينة مطلوب' })
  @MaxLength(255)
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'يجب اختيار الفرع' })
  branchId!: string;

  @ApiProperty({ format: 'uuid', description: 'الحساب المحاسبي (نقدية)' })
  @IsUUID('4', { message: 'يجب اختيار الحساب المحاسبي' })
  accountId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}
