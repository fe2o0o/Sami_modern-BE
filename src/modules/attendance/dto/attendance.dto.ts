import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AppFeature, PunchSource, PunchStatus, PunchType } from '../attendance.enum';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const PIN_PATTERN = /^\d{4,6}$/;

// ── shifts ─────────────────────────────────────────────
export class CreateShiftDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @ApiProperty({ example: '09:00' }) @Matches(HHMM, { message: 'وقت البداية بصيغة HH:mm' }) startTime!: string;
  @ApiProperty({ example: '17:00' }) @Matches(HHMM, { message: 'وقت النهاية بصيغة HH:mm' }) endTime!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) lateGraceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) earlyLeaveGraceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(600) overtimeAfterMinutes?: number;
  @ApiPropertyOptional({ type: [Number], description: '0 = الأحد … 6 = السبت' })
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weeklyOffDays?: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
}
export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

// ── holidays ───────────────────────────────────────────
export class CreateHolidayDto {
  @ApiProperty() @IsDateString() holidayDate!: string;
  /** Several consecutive days in one go (e.g. a 3-day Eid). */
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @ApiPropertyOptional({ description: 'فارغ = كل الفروع' }) @IsOptional() @IsUUID() branchId?: string | null;
}
export class HolidayQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() year?: number;
}

// ── branch locations ───────────────────────────────────
export class BranchLocationDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(5000) attendanceRadiusM?: number;
}

// ── employee setup ─────────────────────────────────────
export class EmployeeAttendanceSetupDto {
  @ApiPropertyOptional({ description: 'فارغ = الوردية الافتراضية' }) @IsOptional() @IsUUID() shiftId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() attendanceEnabled?: boolean;
  @ApiPropertyOptional({ description: 'رمز الدخول لتطبيق الموظفين (4–6 أرقام)' })
  @IsOptional() @Matches(PIN_PATTERN, { message: 'الرمز من 4 إلى 6 أرقام' }) pin?: string;
  @ApiPropertyOptional({ description: 'فك إيقاف الدخول بعد محاولات خاطئة' }) @IsOptional() @IsBoolean() unlock?: boolean;
  @ApiPropertyOptional({ enum: AppFeature, isArray: true, description: 'أقسام بوابة الموظف المسموحة' })
  @IsOptional() @IsArray() @IsEnum(AppFeature, { each: true }) appPermissions?: AppFeature[];
}

export class AttendanceEmployeesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

// ── punches ────────────────────────────────────────────
export class PunchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: PunchStatus }) @IsOptional() @IsEnum(PunchStatus) status?: PunchStatus;
  @ApiPropertyOptional({ enum: PunchSource }) @IsOptional() @IsEnum(PunchSource) source?: PunchSource;
}

/** HR adds a missed punch by hand (Cairo date + time). */
export class ManualPunchDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsDateString() workDate!: string;
  @ApiProperty({ example: '09:05' }) @Matches(HHMM, { message: 'الوقت بصيغة HH:mm' }) time!: string;
  /** The punch happened the day after the work date (overnight shift). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() nextDay?: boolean;
  @ApiProperty({ enum: PunchType }) @IsEnum(PunchType) punchType!: PunchType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string | null;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class VoidPunchDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

// ── reports ────────────────────────────────────────────
export class DailyBoardQueryDto {
  @ApiPropertyOptional({ description: 'افتراضياً اليوم (توقيت القاهرة)' }) @IsOptional() @IsDateString() date?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class MonthlyQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(MONTH, { message: 'الشهر بصيغة YYYY-MM' }) month!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
}

export class EmployeeMonthQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(MONTH, { message: 'الشهر بصيغة YYYY-MM' }) month!: string;
}
