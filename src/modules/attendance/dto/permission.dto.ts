import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { LeaveRequestStatus, PermissionType } from '../attendance.enum';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Query-string boolean ("false" must stay false). */
const QueryBool = () => Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true' || obj[key] === '1');

/** A permission request (app or HR). */
export class PermissionBodyDto {
  @ApiProperty({ enum: PermissionType }) @IsEnum(PermissionType, { message: 'نوع الإذن غير صحيح' }) permissionType!: PermissionType;
  @ApiProperty({ format: 'date' }) @IsDateString({}, { message: 'تاريخ الإذن غير صحيح' }) permissionDate!: string;
  /** Missions only: the whole shift (no times). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() fullDay?: boolean;
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(HHMM, { message: 'وقت البداية غير صحيح (HH:mm)' }) fromTime?: string | null;
  @ApiPropertyOptional({ example: '11:00' }) @IsOptional() @Matches(HHMM, { message: 'وقت النهاية غير صحيح (HH:mm)' }) toTime?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string | null;
}

/** HR enters a permission for an employee (optionally approved at once). */
export class CreatePermissionDto extends PermissionBodyDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() approveNow?: boolean;
}

/** Preview from the app (query string). */
export class PermissionPreviewQueryDto {
  @ApiProperty({ enum: PermissionType }) @IsEnum(PermissionType) permissionType!: PermissionType;
  @ApiProperty({ format: 'date' }) @IsDateString() permissionDate!: string;
  @ApiPropertyOptional() @IsOptional() @QueryBool() @IsBoolean() fullDay?: boolean;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) fromTime?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) toTime?: string;
}

export class PermissionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeaveRequestStatus }) @IsOptional() @IsEnum(LeaveRequestStatus) status?: LeaveRequestStatus;
  @ApiPropertyOptional({ enum: PermissionType }) @IsOptional() @IsEnum(PermissionType) permissionType?: PermissionType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

export class PermissionSettingsDto {
  /** Hours per month; null / omitted = no cap. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(200) personalPermissionHoursPerMonth?: number | null;
}
