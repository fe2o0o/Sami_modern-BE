import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiConversationService } from './ai-conversation.service';
import { AiToolRegistry } from './tools/tool-registry';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';
import { CustomerAiTools } from './tools/customer.tools';
import { SupplierAiTools } from './tools/supplier.tools';
import { SalesAiTools } from './tools/sales.tools';
import { PurchaseAiTools } from './tools/purchase.tools';
import { InventoryAiTools } from './tools/inventory.tools';
import { FinanceAiTools } from './tools/finance.tools';
import { AccountingAiTools } from './tools/accounting.tools';
import { ContextAiTools } from './tools/context.tools';
import { NavigationAiTools } from './tools/navigation.tools';
import { VoucherAiTools } from './tools/voucher.tools';
import { ReferenceAiTools } from './tools/reference.tools';
// Feature modules whose (exported) services the AI tools reuse — no business logic is duplicated.
import { CustomerModule } from '../customer/customer.module';
import { SupplierModule } from '../supplier/supplier.module';
import { SalesInvoiceModule } from '../sales-invoice/sales-invoice.module';
import { PurchaseInvoiceModule } from '../purchase-invoice/purchase-invoice.module';
import { StockModule } from '../stock/stock.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AccountingReportModule } from '../accounting-report/accounting-report.module';
import { ChartOfAccountModule } from '../chart-of-account/chart-of-account.module';
import { FiscalYearModule } from '../fiscal-year/fiscal-year.module';
import { AccountingPeriodModule } from '../accounting-period/accounting-period.module';
import { AccountingSettingModule } from '../accounting-setting/accounting-setting.module';
import { VoucherModule } from '../voucher/voucher.module';
import { JournalEntryModule } from '../journal-entry/journal-entry.module';
import { SalesReturnModule } from '../sales-return/sales-return.module';
import { PurchaseReturnModule } from '../purchase-return/purchase-return.module';
import { ProductModule } from '../product/product.module';
import { LookupsModule } from '../lookups/lookups.module';

/**
 * AI ERP Assistant (read-only V1). Reuses existing domain services via a
 * controlled tool registry; the global JwtAuthGuard protects the endpoint and
 * every tool re-enforces its permission + the caller's branch scope.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiAuditLog, AiConversation, AiMessage]),
    CustomerModule,
    SupplierModule,
    SalesInvoiceModule,
    PurchaseInvoiceModule,
    StockModule,
    DashboardModule,
    AccountingReportModule,
    ChartOfAccountModule,
    FiscalYearModule,
    AccountingPeriodModule,
    AccountingSettingModule,
    VoucherModule,
    JournalEntryModule,
    SalesReturnModule,
    PurchaseReturnModule,
    ProductModule,
    LookupsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiConversationService,
    AiToolRegistry,
    CustomerAiTools,
    SupplierAiTools,
    SalesAiTools,
    PurchaseAiTools,
    InventoryAiTools,
    FinanceAiTools,
    AccountingAiTools,
    ContextAiTools,
    NavigationAiTools,
    VoucherAiTools,
    ReferenceAiTools,
  ],
})
export class AiModule {}
