import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PIN_PATTERN } from './attendance.dto';

export class EmployeeAppLoginDto {
  @ApiProperty({ example: '01000000000' }) @IsString() @IsNotEmpty() @MaxLength(30) mobile!: string;
  @ApiProperty({ example: '1234' }) @Matches(PIN_PATTERN, { message: 'الرمز من 4 إلى 6 أرقام' }) pin!: string;
}

export class EmployeeAppChangePinDto {
  @ApiProperty() @Matches(PIN_PATTERN, { message: 'الرمز من 4 إلى 6 أرقام' }) currentPin!: string;
  @ApiProperty() @Matches(PIN_PATTERN, { message: 'الرمز من 4 إلى 6 أرقام' }) newPin!: string;
}

/** The phone's location when the employee taps «تسجيل حضور / انصراف». */
export class EmployeeAppPunchDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiPropertyOptional({ description: 'دقة الموقع بالمتر' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) accuracy?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) deviceInfo?: string;
}

export class EmployeeAppMonthQueryDto {
  @ApiPropertyOptional({ example: '2026-11' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'الشهر بصيغة YYYY-MM' })
  month?: string;
}
