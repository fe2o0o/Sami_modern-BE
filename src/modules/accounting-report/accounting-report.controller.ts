import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeneralLedgerService } from './general-ledger.service';
import { TrialBalanceService } from './trial-balance.service';
import { FinancialStatementsService } from './financial-statements.service';
import { TreasuryCashReportService, CashAccountKind } from './treasury-cash-report.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { FinancialStatementQueryDto } from './dto/financial-statement-query.dto';
import { CashAccountsReportQueryDto } from './dto/cash-accounts-report-query.dto';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';

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
    private readonly treasuryCashReport: TreasuryCashReportService,
  ) {}

  @Get('general-ledger')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'الأستاذ العام — حركة وأرصدة حساب من القيود المرحلة' })
  getGeneralLedger(@Query() query: GeneralLedgerQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.generalLedger.generate(query, branchScope);
  }

  @Get('trial-balance')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'ميزان المراجعة — أرصدة الحسابات من القيود المرحلة' })
  getTrialBalance(@Query() query: TrialBalanceQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.trialBalance.generate(query, branchScope);
  }

  @Get('income-statement')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'قائمة الدخل — الإيرادات والمصروفات وصافي الربح للفترة' })
  getIncomeStatement(@Query() query: FinancialStatementQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.financialStatements.incomeStatement(query, branchScope);
  }

  @Get('balance-sheet')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'الميزانية — الأصول والخصوم وحقوق الملكية حتى تاريخ' })
  getBalanceSheet(@Query() query: FinancialStatementQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.financialStatements.balanceSheet(query, branchScope);
  }

  @Get('cash-accounts')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'تقرير الخزائن — أرصدة وحركة الخزائن والحسابات البنكية' })
  getCashAccounts(@Query() query: CashAccountsReportQueryDto, @BranchScope() branchScope: string[] | null) {
    return this.treasuryCashReport.summary(query, branchScope);
  }

  @Get('cash-accounts/:kind/:id/statement')
  @RequirePermissions('accounting_reports.view')
  @ApiOperation({ summary: 'كشف حركة خزينة/حساب بنكي معيّن' })
  getCashAccountStatement(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query() query: CashAccountsReportQueryDto,
    @BranchScope() branchScope: string[] | null,
  ) {
    if (kind !== 'treasury' && kind !== 'bank') {
      throw new BadRequestException('نوع الحساب غير صالح');
    }
    return this.treasuryCashReport.statement(kind as CashAccountKind, id, query, branchScope);
  }
}
