import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeneralLedgerService } from './general-ledger.service';
import { TrialBalanceService } from './trial-balance.service';
import { FinancialStatementsService } from './financial-statements.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { FinancialStatementQueryDto } from './dto/financial-statement-query.dto';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';

/** Force a branch-restricted user's reports onto their own branch. */
function scoped<T extends { branchId?: string }>(query: T, branchScope: string | null): T {
  if (branchScope) query.branchId = branchScope;
  return query;
}

/**
 * Read-only accounting reports. These endpoints NEVER write accounting data —
 * they only read POSTED journal lines. (Intended permissions once a permissions
 * module exists: general_ledger.view / trial_balance.view. For now they rely on
 * the global JWT guard like every other endpoint.)
 */
@ApiTags('Accounting Reports')
@ApiBearerAuth('access-token')
@Controller('accounting')
export class AccountingReportController {
  constructor(
    private readonly generalLedger: GeneralLedgerService,
    private readonly trialBalance: TrialBalanceService,
    private readonly financialStatements: FinancialStatementsService,
  ) {}

  @Get('general-ledger')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'الأستاذ العام — حركة وأرصدة حساب من القيود المرحلة' })
  getGeneralLedger(@Query() query: GeneralLedgerQueryDto, @BranchScope() branchScope: string | null) {
    return this.generalLedger.generate(scoped(query, branchScope));
  }

  @Get('trial-balance')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'ميزان المراجعة — أرصدة الحسابات من القيود المرحلة' })
  getTrialBalance(@Query() query: TrialBalanceQueryDto, @BranchScope() branchScope: string | null) {
    return this.trialBalance.generate(scoped(query, branchScope));
  }

  @Get('income-statement')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'قائمة الدخل — الإيرادات والمصروفات وصافي الربح للفترة' })
  getIncomeStatement(@Query() query: FinancialStatementQueryDto, @BranchScope() branchScope: string | null) {
    return this.financialStatements.incomeStatement(scoped(query, branchScope));
  }

  @Get('balance-sheet')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'الميزانية — الأصول والخصوم وحقوق الملكية حتى تاريخ' })
  getBalanceSheet(@Query() query: FinancialStatementQueryDto, @BranchScope() branchScope: string | null) {
    return this.financialStatements.balanceSheet(scoped(query, branchScope));
  }
}
