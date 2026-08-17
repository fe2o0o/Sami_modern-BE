import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeneralLedgerService } from './general-ledger.service';
import { TrialBalanceService } from './trial-balance.service';
import { FinancialStatementsService } from './financial-statements.service';
import { GeneralLedgerQueryDto } from './dto/general-ledger-query.dto';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { FinancialStatementQueryDto } from './dto/financial-statement-query.dto';

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
  @ApiOperation({ summary: 'الأستاذ العام — حركة وأرصدة حساب من القيود المرحلة' })
  getGeneralLedger(@Query() query: GeneralLedgerQueryDto) {
    return this.generalLedger.generate(query);
  }

  @Get('trial-balance')
  @ApiOperation({ summary: 'ميزان المراجعة — أرصدة الحسابات من القيود المرحلة' })
  getTrialBalance(@Query() query: TrialBalanceQueryDto) {
    return this.trialBalance.generate(query);
  }

  @Get('income-statement')
  @ApiOperation({ summary: 'قائمة الدخل — الإيرادات والمصروفات وصافي الربح للفترة' })
  getIncomeStatement(@Query() query: FinancialStatementQueryDto) {
    return this.financialStatements.incomeStatement(query);
  }

  @Get('balance-sheet')
  @ApiOperation({ summary: 'الميزانية — الأصول والخصوم وحقوق الملكية حتى تاريخ' })
  getBalanceSheet(@Query() query: FinancialStatementQueryDto) {
    return this.financialStatements.balanceSheet(query);
  }
}
