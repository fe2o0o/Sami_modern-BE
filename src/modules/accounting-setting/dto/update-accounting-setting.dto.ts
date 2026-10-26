import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';
import { applyDecorators } from '@nestjs/common';

/**
 * Optional account-id field: accepts a UUID, an explicit `null` (to clear the
 * mapping), or absence (partial update). Non-UUID strings are rejected.
 */
function AccountId() {
  return applyDecorators(
    ApiPropertyOptional({ format: 'uuid', nullable: true }),
    IsOptional(),
    ValidateIf((_, value) => value !== null),
    IsUUID('4', { message: 'معرّف الحساب غير صالح' }),
  );
}

/**
 * Update payload for the single accounting-settings record. Every field is an
 * optional account id so the settings page can send partial updates. All
 * messages are Arabic.
 */
export class UpdateAccountingSettingDto {
  // ── Sales ──
  @AccountId()
  salesRevenueAccountId?: string | null;

  // ── Inventory ──
  @AccountId()
  rawMaterialInventoryAccountId?: string | null;

  @AccountId()
  finishedGoodsInventoryAccountId?: string | null;

  @AccountId()
  costOfGoodsSoldAccountId?: string | null;

  @AccountId()
  inventoryAdjustmentAccountId?: string | null;

  /** «بضاعة مباعة لم تُسلَّم» — enables cost of sales at invoice posting. */
  @AccountId()
  goodsSoldNotDeliveredAccountId?: string | null;

  @AccountId()
  manufacturingFeeAccountId?: string | null;

  // ── Customers & Suppliers ──
  @AccountId()
  customerControlAccountId?: string | null;

  @AccountId()
  supplierControlAccountId?: string | null;

  // ── Cash & Banks ──
  @AccountId()
  defaultCashAccountId?: string | null;

  @AccountId()
  defaultBankAccountId?: string | null;

  // ── Taxes ──
  @AccountId()
  inputVatAccountId?: string | null;

  @AccountId()
  outputVatAccountId?: string | null;

  // ── Sales Commission ──
  @AccountId()
  commissionExpenseAccountId?: string | null;

  @AccountId()
  commissionPayableAccountId?: string | null;

  // ── Employees (HR) ──
  @AccountId()
  employeeAdvancesAccountId?: string | null;

  @AccountId()
  employeeCustodyAccountId?: string | null;

  /** Max advance = X × net salary (empty = no ceiling). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({}, { message: 'الحد الأقصى للسلفة يجب أن يكون رقماً' })
  @Min(0.1, { message: 'الحد الأقصى للسلفة يجب أن يكون أكبر من صفر' })
  maxAdvanceSalaryMultiple?: number | null;

  // ── Opening Balances ──
  @AccountId()
  openingBalanceEquityAccountId?: string | null;
}
