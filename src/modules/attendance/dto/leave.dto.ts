import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

/** Query-string boolean ("false" must stay false). */
const QueryBool = () => Transform(({ obj, key }) => obj[key] === true || obj[key] === 'true' || obj[key] === '1');
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { HrRequestStatus, HrRequestType, LeaveRequestStatus } from '../attendance.enum';

// ── leave types ────────────────────────────────────────
export class CreateLeaveTypeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) nameEn?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(366) defaultDaysPerYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasBalance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPaid?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}
export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {}

// ── balances ───────────────────────────────────────────
export class LeaveBalancesQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}
export class SetLeaveBalanceDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) @Max(366) entitledDays!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string | null;
}

// ── requests ───────────────────────────────────────────
export class LeaveRequestBodyDto {
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty() @IsDateString() fromDate!: string;
  @ApiProperty() @IsDateString() toDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string | null;
}
/** HR enters a leave for an employee. */
export class CreateLeaveRequestDto extends LeaveRequestBodyDto {
  @ApiProperty() @IsUUID() employeeId!: string;
  /** Approve at once (needs leaves.approve). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() approveNow?: boolean;
}
export class LeavePreviewQueryDto {
  @ApiProperty() @IsUUID() leaveTypeId!: string;
  @ApiProperty() @IsDateString() fromDate!: string;
  @ApiProperty() @IsDateString() toDate!: string;
}
export class LeaveRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeaveRequestStatus }) @IsOptional() @IsEnum(LeaveRequestStatus) status?: LeaveRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() leaveTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
export class DecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

// ── HR requests ────────────────────────────────────────
export class HrRequestBodyDto {
  @ApiProperty({ enum: HrRequestType }) @IsEnum(HrRequestType) requestType!: HrRequestType;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) subject!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) details?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number | null;
}
export class HrRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HrRequestStatus }) @IsOptional() @IsEnum(HrRequestStatus) status?: HrRequestStatus;
  @ApiPropertyOptional({ enum: HrRequestType }) @IsOptional() @IsEnum(HrRequestType) requestType?: HrRequestType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  /** Only open ones (new + in progress). */
  @ApiPropertyOptional() @IsOptional() @QueryBool() @IsBoolean() open?: boolean;
}
export class HrRequestUpdateDto {
  @ApiProperty({ enum: [HrRequestStatus.IN_PROGRESS, HrRequestStatus.DONE, HrRequestStatus.REJECTED] })
  @IsIn([HrRequestStatus.IN_PROGRESS, HrRequestStatus.DONE, HrRequestStatus.REJECTED])
  status!: HrRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) reply?: string | null;
}

/** Approve a portal advance request → creates an APPROVED employee advance (paid later from the advances page). */
export class ApproveAdvanceRequestDto {
  @ApiProperty() @Type(() => Number) @IsNumber({}, { message: 'مبلغ السلفة يجب أن يكون رقماً' }) @Min(0.01, { message: 'مبلغ السلفة يجب أن يكون أكبر من صفر' }) amount!: number;
  @ApiProperty({ default: 1 }) @Type(() => Number) @IsInt({ message: 'عدد الأقساط يجب أن يكون رقماً صحيحاً' }) @Min(1, { message: 'عدد الأقساط يجب أن يكون 1 على الأقل' }) @Max(120, { message: 'عدد الأقساط كبير جداً' }) installmentsCount!: number;
  @ApiProperty({ format: 'date', description: 'أول شهر خصم (أي يوم فيه)' }) @IsDateString({}, { message: 'أول شهر خصم غير صحيح' }) firstDeductionMonth!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) reply?: string | null;
}

/** «مبيعاتي» period (default: this month, Egypt time). */
export class MySalesQueryDto {
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({}, { message: 'تاريخ البداية غير صحيح' }) from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsDateString({}, { message: 'تاريخ النهاية غير صحيح' }) to?: string;
  /** Another employee's sales — needs «مبيعات كل الموظفين». */
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() employeeId?: string;
}

// ── employee app: catalog / customers ──────────────────
export class AppListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @QueryBool() @IsBoolean() inStock?: boolean;
}
