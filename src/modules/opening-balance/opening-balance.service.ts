import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { OpeningBalance } from './entities/opening-balance.entity';
import { OpeningBalanceDetail } from './entities/opening-balance-detail.entity';
import { CreateOpeningBalanceDto } from './dto/create-opening-balance.dto';
import { UpdateOpeningBalanceDto } from './dto/update-opening-balance.dto';
import { OpeningBalanceDetailDto } from './dto/opening-balance-detail.dto';
import { ReverseOpeningBalanceDto } from './dto/reverse-opening-balance.dto';
import {
  ACCOUNT_BEARING_TYPES,
  OB_REVERSAL_SOURCE_TYPE,
  OB_SOURCE_TYPE,
  OpeningBalanceReferenceType,
  OpeningBalanceStatus,
} from './enums/opening-balance.enum';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { Company } from '../company/entities/company.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Product } from '../product/entities/product.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Role } from '../role/entities/role.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { ProductType } from '../product/enums/product-type.enum';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { StockService, OpeningStockItem } from '../stock/stock.service';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { TreasuryLedgerService } from '../treasury/treasury-ledger.service';
import { BankLedgerService } from '../bank-account/bank-ledger.service';
import { TreasuryTransactionType } from '../treasury/enums/treasury-transaction.enum';
import { BankTransactionType } from '../bank-account/enums/bank-transaction.enum';
import {
  AccountingImpact,
  OpeningBalanceAccountingBuilder,
} from './opening-balance.accounting-builder';

/** One journal line enriched with account code/name for display. */
export interface PreviewLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  isSystemGenerated: boolean;
}

/** Read-only journal preview / posted-entry view of an opening balance. */
export interface JournalPreview {
  journalLines: PreviewLine[];
  rawTotals: { debit: number; credit: number; difference: number };
  balancingLine: PreviewLine | null;
  balancingAccount: { id: string; code: string; name: string } | null;
  finalTotals: { debit: number; credit: number; difference: number };
  autoBalance: boolean;
  isBalanced: boolean;
}

/** The actually-posted journal entry, for the "عرض القيد المحاسبي" view. */
export interface PostedJournalEntry {
  entryNumber: string;
  entryDate: string;
  accountingPeriodId: string;
  sourceType: string;
  description: string | null;
  lines: PreviewLine[];
  totalDebit: number;
  totalCredit: number;
}

/** A projected negative-stock line surfaced by the reversal impact analysis. */
export interface NegativeStockWarning {
  productId: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  currentQuantity: number;
  reversalQuantity: number;
  projectedQuantity: number;
}

/** Pre-flight analysis returned before a reversal is executed. */
export interface ReversalImpact {
  canReverse: boolean;
  requiresConfirmation: boolean;
  requiresForce: boolean;
  journal: { entryId: string | null; debit: number; credit: number };
  customers: { affected: number };
  suppliers: { affected: number };
  inventory: {
    affectedProducts: number;
    negativeStockWarnings: NegativeStockWarning[];
  };
  warnings: string[];
}

/** Treasury/bank/warehouse refs used to derive detail account + branch. */
interface DetailRefs {
  treasuryById: Map<string, { accountId: string; branchId: string }>;
  bankById: Map<string, { accountId: string; branchId: string }>;
  warehouseBranchById: Map<string, string>;
}

/** Loaded reference data used across validation and posting. */
interface OpeningContext {
  settings: AccountingSetting | null;
  accountsById: Map<string, ChartOfAccount>;
  customerIds: Set<string>;
  supplierIds: Set<string>;
  productsById: Map<string, Product>;
  warehouseIds: Set<string>;
}

/** Outcome of a validation pass — surfaced to the UI before posting. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
}

const BALANCE_TOLERANCE = 0.005;

@Injectable()
export class OpeningBalanceService {
  constructor(
    @InjectRepository(OpeningBalance)
    private readonly openingBalanceRepository: Repository<OpeningBalance>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(AccountingSetting)
    private readonly settingRepository: Repository<AccountingSetting>,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(WarehouseStock)
    private readonly warehouseStockRepository: Repository<WarehouseStock>,
    @InjectRepository(Treasury)
    private readonly treasuryRepository: Repository<Treasury>,
    @InjectRepository(BankAccount)
    private readonly bankAccountRepository: Repository<BankAccount>,
    private readonly journalEntryService: JournalEntryService,
    private readonly stockService: StockService,
    private readonly treasuryLedger: TreasuryLedgerService,
    private readonly bankLedger: BankLedgerService,
    private readonly accountingBuilder: OpeningBalanceAccountingBuilder,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // CREATE
  // =========================================================
  async create(
    dto: CreateOpeningBalanceDto,
    actorId?: string,
  ): Promise<OpeningBalance> {
    const company = await this.getCompany();
    const fiscalYear = await this.getFiscalYear(dto.fiscalYearId);
    const period = await this.getPeriod(dto.accountingPeriodId, fiscalYear.id);
    await this.ensureAccountingSettingsExist();

    if (period.isClosed) {
      throw new BadRequestException('الفترة المحاسبية مغلقة');
    }
    this.assertDateInFiscalYear(dto.openingDate, fiscalYear);

    await this.ensureNoActiveBalance(fiscalYear.id);

    const autoBalance = dto.autoBalance ?? true;
    const refs = await this.loadDetailRefs(dto.details ?? []);
    const openingBalance = this.openingBalanceRepository.create({
      companyId: company.id,
      fiscalYearId: fiscalYear.id,
      accountingPeriodId: period.id,
      openingDate: dto.openingDate,
      notes: dto.notes ?? null,
      autoBalance,
      status: OpeningBalanceStatus.DRAFT,
      details: this.buildDetails(dto.details ?? [], refs),
      createdBy: actorId ?? null,
    });

    return this.openingBalanceRepository.save(openingBalance);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(fiscalYearId?: string): Promise<OpeningBalance[]> {
    return this.openingBalanceRepository.find({
      where: fiscalYearId ? { fiscalYearId } : {},
      order: { openingDate: 'DESC' },
    });
  }

  async findOne(id: string): Promise<OpeningBalance> {
    const openingBalance = await this.openingBalanceRepository.findOne({
      where: { id },
      relations: { details: true },
      order: { details: { lineNumber: 'ASC' } },
    });
    if (!openingBalance) {
      throw new NotFoundException('لم يتم العثور على الرصيد الافتتاحي');
    }
    return openingBalance;
  }

  // =========================================================
  // UPDATE (draft only, full detail replace)
  // =========================================================
  async update(
    id: string,
    dto: UpdateOpeningBalanceDto,
    actorId?: string,
  ): Promise<OpeningBalance> {
    const openingBalance = await this.findOne(id);
    this.assertNotPosted(openingBalance);

    const fiscalYear = await this.getFiscalYear(openingBalance.fiscalYearId);

    if (dto.accountingPeriodId) {
      const period = await this.getPeriod(dto.accountingPeriodId, fiscalYear.id);
      if (period.isClosed) {
        throw new BadRequestException('الفترة المحاسبية مغلقة');
      }
      openingBalance.accountingPeriodId = period.id;
    }
    if (dto.openingDate) {
      this.assertDateInFiscalYear(dto.openingDate, fiscalYear);
      openingBalance.openingDate = dto.openingDate;
    }
    if (dto.notes !== undefined) {
      openingBalance.notes = dto.notes ?? null;
    }
    if (dto.autoBalance !== undefined) {
      openingBalance.autoBalance = dto.autoBalance;
    }

    // Editing invalidates a previous "validated" state.
    openingBalance.status = OpeningBalanceStatus.DRAFT;
    openingBalance.updatedBy = actorId ?? null;

    if (dto.details) {
      // Store only the user rows; the equity balancing line is never persisted —
      // it is derived by the accounting builder for both preview and posting.
      const refs = await this.loadDetailRefs(dto.details);
      const details = this.buildDetails(dto.details, refs);
      return this.dataSource.transaction(async (manager) => {
        await manager.delete(OpeningBalanceDetail, { openingBalanceId: id });
        openingBalance.details = details;
        return manager.getRepository(OpeningBalance).save(openingBalance);
      });
    }

    return this.openingBalanceRepository.save(openingBalance);
  }

  // =========================================================
  // VALIDATE
  // =========================================================
  async validate(id: string, actorId?: string): Promise<ValidationResult> {
    const openingBalance = await this.findOne(id);
    this.assertNotPosted(openingBalance);

    const result = await this.runValidation(openingBalance);

    // Only promote to "validated" when the checks pass.
    if (result.valid) {
      openingBalance.status = OpeningBalanceStatus.VALIDATED;
      openingBalance.updatedBy = actorId ?? null;
      await this.openingBalanceRepository.save(openingBalance);
    }

    return result;
  }

  // =========================================================
  // POST (transaction: journal entry + mark posted)
  // =========================================================
  async post(id: string, actorId?: string): Promise<OpeningBalance> {
    const openingBalance = await this.findOne(id);
    this.assertNotPosted(openingBalance);

    const result = await this.runValidation(openingBalance);
    if (!result.valid) {
      throw new BadRequestException(result.errors.join(' | '));
    }

    const fiscalYear = await this.getFiscalYear(openingBalance.fiscalYearId);
    const details = openingBalance.details ?? [];
    const ctx = await this.loadContext(details);

    // Same builder as the preview → the posted entry matches what was shown.
    const impact = this.buildImpact(openingBalance, ctx);
    const lines = impact.journalLines.map((l) => ({
      accountId: l.accountId,
      branchId: l.branchId, // per-line branch → branch-level GL traceability
      debit: l.debit,
      credit: l.credit,
      description: l.isSystemGenerated ? 'موازنة الأرصدة الافتتاحية' : null,
    }));

    const cashDetails = details.filter(
      (d) => d.referenceType === OpeningBalanceReferenceType.CASH && d.treasuryId,
    );
    const bankDetails = details.filter(
      (d) => d.referenceType === OpeningBalanceReferenceType.BANK && d.bankAccountId,
    );

    // Inventory rows also drive the warehouse stock (separate from the ledger).
    const stockItems: OpeningStockItem[] = details
      .filter((d) => d.referenceType === OpeningBalanceReferenceType.INVENTORY)
      .map((d) => ({
        warehouseId: d.warehouseId as string,
        productId: d.productId as string,
        quantity: d.quantity || 0,
        unitCost: d.unitCost || 0,
        notes: d.notes,
      }));

    return this.dataSource.transaction(async (manager) => {
      const journalEntry = await this.journalEntryService.createSystemJournalEntry(
        {
          sourceType: OB_SOURCE_TYPE,
          sourceId: openingBalance.id,
          sourceNumber: null,
          entryDate: openingBalance.openingDate,
          fiscalYearId: openingBalance.fiscalYearId,
          accountingPeriodId: openingBalance.accountingPeriodId,
          description: `قيد الأرصدة الافتتاحية - ${fiscalYear.name}`,
          lines,
          actorId,
        },
        manager,
      );

      // Inventory opening transactions + warehouse stock updates.
      if (stockItems.length) {
        await this.stockService.applyOpening(stockItems, manager, {
          movementDate: openingBalance.openingDate,
          sourceId: openingBalance.id,
          actorId,
        });
      }

      // Operational cash/bank subledgers (debit = money on hand).
      for (const d of cashDetails) {
        await this.treasuryLedger.record(
          {
            treasuryId: d.treasuryId as string,
            transactionDate: openingBalance.openingDate,
            type: TreasuryTransactionType.OPENING_BALANCE,
            sourceType: OB_SOURCE_TYPE,
            sourceId: openingBalance.id,
            sourceNumber: journalEntry.entryNumber,
            debit: d.debit,
            credit: d.credit,
            description: 'رصيد افتتاحي',
            journalEntryId: journalEntry.id,
            actorId,
          },
          manager,
        );
      }
      for (const d of bankDetails) {
        await this.bankLedger.record(
          {
            bankAccountId: d.bankAccountId as string,
            transactionDate: openingBalance.openingDate,
            type: BankTransactionType.OPENING_BALANCE,
            sourceType: OB_SOURCE_TYPE,
            sourceId: openingBalance.id,
            sourceNumber: journalEntry.entryNumber,
            debit: d.debit,
            credit: d.credit,
            description: 'رصيد افتتاحي',
            journalEntryId: journalEntry.id,
            actorId,
          },
          manager,
        );
      }

      openingBalance.status = OpeningBalanceStatus.POSTED;
      openingBalance.posted = true;
      openingBalance.postedAt = new Date();
      openingBalance.postedBy = actorId ?? null;
      openingBalance.journalEntryId = journalEntry.id;
      openingBalance.updatedBy = actorId ?? null;

      return manager.getRepository(OpeningBalance).save(openingBalance);
    });
  }

  // =========================================================
  // REVERSAL IMPACT (pre-flight analysis)
  // =========================================================
  async reversalImpact(id: string): Promise<ReversalImpact> {
    const openingBalance = await this.findOne(id);
    if (openingBalance.status !== OpeningBalanceStatus.POSTED) {
      throw new BadRequestException('لا يمكن عكس رصيد افتتاحي غير مُرحّل');
    }

    const details = openingBalance.details ?? [];
    const journalEntry = openingBalance.journalEntryId
      ? await this.journalEntryService.findWithLines(openingBalance.journalEntryId)
      : null;

    const customerIds = new Set(
      details
        .filter((d) => d.referenceType === OpeningBalanceReferenceType.CUSTOMER)
        .map((d) => d.customerId),
    );
    const supplierIds = new Set(
      details
        .filter((d) => d.referenceType === OpeningBalanceReferenceType.SUPPLIER)
        .map((d) => d.supplierId),
    );

    const inventory = await this.computeInventoryImpact(details);
    const warnings = inventory.warnings.map(
      (w) =>
        `عكس الرصيد الافتتاحي سيؤدي إلى رصيد مخزون سالب للمنتج "${w.productName}" ` +
        `في المخزن "${w.warehouseName}" بمقدار ${Math.abs(w.projectedQuantity)} وحدة.`,
    );

    return {
      canReverse: !!journalEntry,
      requiresConfirmation: true,
      requiresForce: inventory.warnings.length > 0,
      journal: {
        entryId: journalEntry?.id ?? null,
        debit: journalEntry?.totalDebit ?? 0,
        credit: journalEntry?.totalCredit ?? 0,
      },
      customers: { affected: customerIds.size },
      suppliers: { affected: supplierIds.size },
      inventory: {
        affectedProducts: inventory.affectedProducts,
        negativeStockWarnings: inventory.warnings,
      },
      warnings,
    };
  }

  // =========================================================
  // REVERSE (one transaction, row-locked, idempotent)
  // =========================================================
  async reverse(
    id: string,
    dto: ReverseOpeningBalanceDto,
    actorId?: string,
    roleId?: string,
  ): Promise<OpeningBalance> {
    if (dto.force) {
      await this.ensureCanForceReverse(roleId);
    }

    // Reversal posts into the chosen OPEN period on the given date.
    const period = await this.getOpenPeriod(dto.accountingPeriodId);
    this.assertDateInPeriod(dto.reversalDate, period);

    return this.dataSource.transaction(async (manager) => {
      // Lock the row so two concurrent reversals can't both proceed.
      const openingBalance = await manager.findOne(OpeningBalance, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!openingBalance) {
        throw new NotFoundException('لم يتم العثور على الرصيد الافتتاحي');
      }
      if (openingBalance.status === OpeningBalanceStatus.REVERSED) {
        throw new ConflictException('الرصيد الافتتاحي معكوس بالفعل');
      }
      if (openingBalance.status !== OpeningBalanceStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس رصيد افتتاحي غير مُرحّل');
      }

      const details = await manager.find(OpeningBalanceDetail, {
        where: { openingBalanceId: id },
        order: { lineNumber: 'ASC' },
      });

      const original = openingBalance.journalEntryId
        ? await this.journalEntryService.findWithLines(openingBalance.journalEntryId)
        : null;
      if (!original) {
        throw new BadRequestException('تعذّر إيجاد القيد الأصلي للرصيد الافتتاحي');
      }

      // Negative-stock protection: block unless explicitly forced.
      const inventory = await this.computeInventoryImpact(details);
      if (inventory.warnings.length > 0 && !dto.force) {
        throw new BadRequestException(
          'عكس الأرصدة سيؤدي إلى مخزون سالب — يتطلب تأكيد العكس الإجباري: ' +
            inventory.warnings
              .map((w) => `${w.productName} (${w.projectedQuantity})`)
              .join('، '),
        );
      }

      // The ORIGINAL posted journal entry is the source of truth: flip its lines
      // (keeping each line's branch so the reversal is branch-traceable too).
      const reversalLines: JournalLineInput[] = original.lines.map((line) => ({
        accountId: line.accountId,
        branchId: line.branchId,
        debit: line.credit,
        credit: line.debit,
        description: line.description
          ? `عكس: ${line.description}`
          : 'عكس رصيد افتتاحي',
      }));

      const reversalEntry = await this.journalEntryService.createSystemJournalEntry(
        {
          sourceType: OB_REVERSAL_SOURCE_TYPE,
          sourceId: openingBalance.id,
          sourceNumber: original.entryNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          description: `عكس ${original.description ?? 'قيد الأرصدة الافتتاحية'}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );

      // Mark the original entry REVERSED and link it to its reversal so the
      // ledger's lifecycle stays consistent (both entries remain posted and
      // net to zero).
      await this.journalEntryService.markEntryReversed(
        original.id,
        reversalEntry.id,
        dto.reason,
        actorId,
        manager,
      );

      // Inventory: create opposite stock movements + recalc balances via the
      // stock domain service (movements remain the source of truth).
      if (inventory.items.length > 0) {
        await this.stockService.applyReversal(inventory.items, manager, {
          movementDate: dto.reversalDate,
          sourceId: openingBalance.id,
          actorId,
        });
      }

      // Operational cash/bank subledgers: opposite movement (history preserved).
      for (const d of details.filter(
        (x) => x.referenceType === OpeningBalanceReferenceType.CASH && x.treasuryId,
      )) {
        await this.treasuryLedger.record(
          {
            treasuryId: d.treasuryId as string,
            transactionDate: dto.reversalDate,
            type: TreasuryTransactionType.REVERSAL,
            sourceType: OB_REVERSAL_SOURCE_TYPE,
            sourceId: openingBalance.id,
            sourceNumber: reversalEntry.entryNumber,
            debit: d.credit,
            credit: d.debit,
            description: 'عكس رصيد افتتاحي',
            journalEntryId: reversalEntry.id,
            actorId,
          },
          manager,
        );
      }
      for (const d of details.filter(
        (x) => x.referenceType === OpeningBalanceReferenceType.BANK && x.bankAccountId,
      )) {
        await this.bankLedger.record(
          {
            bankAccountId: d.bankAccountId as string,
            transactionDate: dto.reversalDate,
            type: BankTransactionType.REVERSAL,
            sourceType: OB_REVERSAL_SOURCE_TYPE,
            sourceId: openingBalance.id,
            sourceNumber: reversalEntry.entryNumber,
            debit: d.credit,
            credit: d.debit,
            description: 'عكس رصيد افتتاحي',
            journalEntryId: reversalEntry.id,
            actorId,
          },
          manager,
        );
      }

      openingBalance.status = OpeningBalanceStatus.REVERSED;
      openingBalance.reversalReason = dto.reason;
      openingBalance.reversedBy = actorId ?? null;
      openingBalance.reversedAt = new Date();
      openingBalance.reversalDate = dto.reversalDate;
      openingBalance.reversalPeriodId = period.id;
      openingBalance.reversalJournalEntryId = reversalEntry.id;
      openingBalance.updatedBy = actorId ?? null;

      await manager.getRepository(OpeningBalance).save(openingBalance);

      return manager.findOne(OpeningBalance, {
        where: { id },
        relations: { details: true },
        order: { details: { lineNumber: 'ASC' } },
      }) as Promise<OpeningBalance>;
    });
  }

  // =========================================================
  // COPY TO NEW DRAFT (correction workflow)
  // =========================================================
  async copyToDraft(id: string, actorId?: string): Promise<OpeningBalance> {
    const source = await this.findOne(id);
    if (source.status !== OpeningBalanceStatus.REVERSED) {
      throw new BadRequestException(
        'يمكن إنشاء نسخة تصحيح فقط من رصيد افتتاحي معكوس',
      );
    }
    await this.ensureNoActiveBalance(source.fiscalYearId);

    const draft = this.openingBalanceRepository.create({
      companyId: source.companyId,
      fiscalYearId: source.fiscalYearId,
      accountingPeriodId: source.accountingPeriodId,
      openingDate: source.openingDate,
      notes: source.notes,
      autoBalance: source.autoBalance,
      status: OpeningBalanceStatus.DRAFT,
      copiedFromOpeningBalanceId: source.id,
      createdBy: actorId ?? null,
      // Skip the auto-generated balancing line — it is regenerated on save.
      details: (source.details ?? [])
        .filter((d) => !d.isSystemGenerated)
        .map((d, index) => {
          const detail = new OpeningBalanceDetail();
          detail.referenceType = d.referenceType;
          detail.lineNumber = index + 1;
          detail.accountId = d.accountId;
          detail.customerId = d.customerId;
          detail.supplierId = d.supplierId;
          detail.warehouseId = d.warehouseId;
          detail.productId = d.productId;
          detail.treasuryId = d.treasuryId;
          detail.bankAccountId = d.bankAccountId;
          detail.branchId = d.branchId;
          detail.quantity = d.quantity;
          detail.unitCost = d.unitCost;
          detail.debit = d.debit;
          detail.credit = d.credit;
          detail.notes = d.notes;
          detail.isSystemGenerated = false;
          return detail;
        }),
    });

    return this.openingBalanceRepository.save(draft);
  }

  // =========================================================
  // REVERSAL HELPERS
  // =========================================================
  /**
   * Project each inventory line against the current on-hand balance and flag
   * any that would go negative. Returns the reversal stock items too (using the
   * ORIGINAL opening quantity & cost).
   */
  private async computeInventoryImpact(details: OpeningBalanceDetail[]): Promise<{
    affectedProducts: number;
    warnings: NegativeStockWarning[];
    items: OpeningStockItem[];
  }> {
    const invRows = details.filter(
      (d) => d.referenceType === OpeningBalanceReferenceType.INVENTORY,
    );

    const items: OpeningStockItem[] = invRows.map((d) => ({
      warehouseId: d.warehouseId as string,
      productId: d.productId as string,
      quantity: d.quantity || 0,
      unitCost: d.unitCost || 0,
      notes: d.notes,
    }));

    const productIds = [...new Set(invRows.map((d) => d.productId).filter((v): v is string => !!v))];
    const warehouseIds = [...new Set(invRows.map((d) => d.warehouseId).filter((v): v is string => !!v))];

    const [products, warehouses] = await Promise.all([
      productIds.length ? this.productRepository.find({ where: { id: In(productIds) } }) : [],
      warehouseIds.length ? this.warehouseRepository.find({ where: { id: In(warehouseIds) } }) : [],
    ]);
    const productName = new Map(products.map((p): [string, string] => [p.id, p.name]));
    const warehouseName = new Map(
      warehouses.map((w): [string, string] => [w.id, w.name]),
    );

    const warnings: NegativeStockWarning[] = [];
    for (const d of invRows) {
      if (!d.warehouseId || !d.productId) continue;
      const stock = await this.warehouseStockRepository.findOne({
        where: { warehouseId: d.warehouseId, productId: d.productId },
      });
      const current = stock?.quantity ?? 0;
      const reversalQuantity = d.quantity || 0;
      const projected = round3(current - reversalQuantity);
      if (projected < 0) {
        warnings.push({
          productId: d.productId,
          productName: productName.get(d.productId) ?? d.productId,
          warehouseId: d.warehouseId,
          warehouseName: warehouseName.get(d.warehouseId) ?? d.warehouseId,
          currentQuantity: current,
          reversalQuantity,
          projectedQuantity: projected,
        });
      }
    }

    return { affectedProducts: productIds.length, warnings, items };
  }

  private async ensureNoActiveBalance(fiscalYearId: string): Promise<void> {
    const active = await this.openingBalanceRepository.count({
      where: { fiscalYearId, status: Not(OpeningBalanceStatus.REVERSED) },
    });
    if (active > 0) {
      throw new ConflictException(
        'يوجد رصيد افتتاحي فعّال لهذه السنة المالية بالفعل',
      );
    }
  }

  private async ensureCanForceReverse(roleId?: string): Promise<void> {
    const role = roleId
      ? await this.roleRepository.findOne({ where: { id: roleId } })
      : null;
    if (!role || role.code !== 'ADMIN') {
      throw new ForbiddenException('العكس الإجباري متاح لمدير النظام فقط');
    }
  }

  private async getOpenPeriod(id: string): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOne({ where: { id } });
    if (!period) {
      throw new NotFoundException('الفترة المحاسبية للعكس غير موجودة');
    }
    if (period.isClosed) {
      throw new BadRequestException(
        'الفترة المحاسبية للعكس مغلقة، يرجى اختيار فترة مفتوحة',
      );
    }
    return period;
  }

  private assertDateInPeriod(date: string, period: AccountingPeriod): void {
    const d = new Date(date).getTime();
    if (
      d < new Date(period.startDate).getTime() ||
      d > new Date(period.endDate).getTime()
    ) {
      throw new BadRequestException(
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة',
      );
    }
  }

  // =========================================================
  // VALIDATION ENGINE
  // =========================================================
  private async runValidation(
    openingBalance: OpeningBalance,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const details = openingBalance.details ?? [];

    // Prerequisites still hold at validation time.
    const fiscalYear = await this.fiscalYearRepository.findOne({
      where: { id: openingBalance.fiscalYearId },
    });
    if (!fiscalYear) {
      errors.push('السنة المالية غير موجودة');
    } else {
      if (fiscalYear.isClosed) {
        errors.push('السنة المالية مغلقة');
      }
      if (!this.isDateInFiscalYear(openingBalance.openingDate, fiscalYear)) {
        errors.push('تاريخ الافتتاح خارج نطاق السنة المالية');
      }
    }

    const period = await this.periodRepository.findOne({
      where: { id: openingBalance.accountingPeriodId },
    });
    if (!period) {
      errors.push('الفترة المحاسبية غير موجودة');
    } else if (period.isClosed) {
      errors.push('الفترة المحاسبية مغلقة');
    }

    if (details.length === 0) {
      errors.push('يجب إدخال بند واحد على الأقل');
    }

    const ctx = await this.loadContext(details);
    const seen = new Set<string>();
    let hasDuplicate = false;
    const markKey = (key: string): void => {
      if (seen.has(key)) hasDuplicate = true;
      seen.add(key);
    };

    for (const row of details) {
      switch (row.referenceType) {
        case OpeningBalanceReferenceType.CUSTOMER:
          if (!row.customerId) {
            errors.push('يجب اختيار عميل لكل بند عملاء');
            break;
          }
          markKey(`cus:${row.customerId}`);
          if (!ctx.customerIds.has(row.customerId)) {
            errors.push('أحد العملاء المختارين غير موجود');
          }
          this.checkDebitCredit(row, errors, 'رصيد العميل');
          break;

        case OpeningBalanceReferenceType.SUPPLIER:
          if (!row.supplierId) {
            errors.push('يجب اختيار مورد لكل بند موردين');
            break;
          }
          markKey(`sup:${row.supplierId}`);
          if (!ctx.supplierIds.has(row.supplierId)) {
            errors.push('أحد الموردين المختارين غير موجود');
          }
          this.checkDebitCredit(row, errors, 'رصيد المورد');
          break;

        case OpeningBalanceReferenceType.INVENTORY: {
          if (!row.warehouseId) errors.push('يجب اختيار مخزن لكل بند مخزون');
          if (!row.productId) errors.push('يجب اختيار منتج لكل بند مخزون');
          if (row.warehouseId && row.productId) {
            markKey(`inv:${row.warehouseId}:${row.productId}`);
          }
          if (row.warehouseId && !ctx.warehouseIds.has(row.warehouseId)) {
            errors.push('أحد المخازن المختارة غير موجود');
          }
          const product = row.productId ? ctx.productsById.get(row.productId) : undefined;
          if (row.productId && !product) {
            errors.push('أحد المنتجات المختارة غير موجود');
          }
          if ((row.quantity || 0) <= 0) {
            errors.push('كمية المخزون يجب أن تكون أكبر من صفر');
          }
          if ((row.unitCost || 0) < 0) {
            errors.push('تكلفة الوحدة يجب ألا تكون سالبة');
          }
          if (product && !this.resolveInventoryAccount(product, ctx.settings)) {
            errors.push(
              `لا يوجد حساب مخزون للمنتج "${product.name}" — يرجى ضبطه في إعدادات المحاسبة`,
            );
          }
          break;
        }

        case OpeningBalanceReferenceType.CASH:
          if (!row.treasuryId) {
            errors.push('يجب اختيار خزينة لكل بند نقدية');
            break;
          }
          markKey(`tre:${row.treasuryId}`);
          this.checkStoredAccount(row, ctx, errors, 'رصيد النقدية');
          break;

        case OpeningBalanceReferenceType.BANK:
          if (!row.bankAccountId) {
            errors.push('يجب اختيار حساب بنكي لكل بند بنوك');
            break;
          }
          markKey(`bnk:${row.bankAccountId}`);
          this.checkStoredAccount(row, ctx, errors, 'رصيد البنك');
          break;

        default: {
          // general_ledger
          if (!row.accountId) {
            errors.push('يجب اختيار حساب لكل بند');
            break;
          }
          markKey(`acc:${row.accountId}`);
          this.checkStoredAccount(row, ctx, errors, 'الحساب');
        }
      }
    }

    // Control accounts must be configured when their rows are present.
    if (
      details.some((d) => d.referenceType === OpeningBalanceReferenceType.CUSTOMER) &&
      !ctx.settings?.customerControlAccountId
    ) {
      errors.push('يجب ضبط حساب مراقبة العملاء في إعدادات المحاسبة');
    }
    if (
      details.some((d) => d.referenceType === OpeningBalanceReferenceType.SUPPLIER) &&
      !ctx.settings?.supplierControlAccountId
    ) {
      errors.push('يجب ضبط حساب مراقبة الموردين في إعدادات المحاسبة');
    }

    if (hasDuplicate) {
      errors.push('يوجد بند مكرر في القائمة');
    }

    // Auto-balancing needs a configured, valid equity account.
    const equityId = ctx.settings?.openingBalanceEquityAccountId;
    if (openingBalance.autoBalance && !equityId) {
      errors.push(
        'يجب تحديد حساب موازنة الأرصدة الافتتاحية من إعدادات المحاسبة قبل استخدام الموازنة التلقائية.',
      );
    } else if (openingBalance.autoBalance && equityId) {
      const equity = await this.accountRepository.findOne({
        where: { id: equityId },
      });
      if (!equity || !equity.isActive || !equity.allowPosting || equity.isHeader) {
        errors.push(
          'حساب موازنة الأرصدة الافتتاحية غير صالح (يجب أن يكون حساباً فرعياً نشطاً قابلاً للترحيل)',
        );
      }
    }

    // Balance is judged on the FINAL entry the accounting builder produces —
    // the same result posting will create.
    const impact = this.buildImpact(openingBalance, ctx);
    if (!impact.isBalanced) {
      errors.push('إجمالي المدين لا يساوي إجمالي الدائن');
    }

    return {
      valid: errors.length === 0,
      errors,
      totalDebit: impact.finalDebit,
      totalCredit: impact.finalCredit,
      difference: impact.difference,
    };
  }

  /**
   * Validate a row's (stored, possibly derived) ledger account is present,
   * active and posting, then that its debit/credit is a valid single side.
   */
  private checkStoredAccount(
    row: OpeningBalanceDetail,
    ctx: OpeningContext,
    errors: string[],
    label: string,
  ): void {
    if (!row.accountId) {
      errors.push(`${label}: لم يتم تحديد الحساب المحاسبي`);
      return;
    }
    const account = ctx.accountsById.get(row.accountId);
    if (!account) {
      errors.push('أحد الحسابات المختارة غير موجود');
      return;
    }
    if (!account.isActive) {
      errors.push(`الحساب "${account.accountNameAr}" غير نشط`);
    }
    if (!account.allowPosting) {
      errors.push(`الحساب "${account.accountNameAr}" لا يقبل الترحيل`);
    }
    this.checkDebitCredit(row, errors, label);
  }

  /** debit XOR credit must be positive. */
  private checkDebitCredit(
    row: OpeningBalanceDetail,
    errors: string[],
    label: string,
  ): void {
    const debit = row.debit || 0;
    const credit = row.credit || 0;
    if (debit > 0 && credit > 0) {
      errors.push(`${label}: لا يمكن إدخال مدين ودائن معاً`);
    }
    if (debit === 0 && credit === 0) {
      errors.push(`${label}: يجب إدخال مدين أو دائن`);
    }
  }

  /** Load the reference data needed to validate and post the details. */
  private async loadContext(
    details: OpeningBalanceDetail[],
  ): Promise<OpeningContext> {
    const settings = await this.settingRepository.findOne({ where: {} });

    const pick = (
      predicate: (d: OpeningBalanceDetail) => boolean,
      key: (d: OpeningBalanceDetail) => string | null,
    ): string[] => [
      ...new Set(
        details.filter(predicate).map(key).filter((v): v is string => !!v),
      ),
    ];

    const accountIds = pick(
      (d) => ACCOUNT_BEARING_TYPES.includes(d.referenceType),
      (d) => d.accountId,
    );
    const customerIds = pick(
      (d) => d.referenceType === OpeningBalanceReferenceType.CUSTOMER,
      (d) => d.customerId,
    );
    const supplierIds = pick(
      (d) => d.referenceType === OpeningBalanceReferenceType.SUPPLIER,
      (d) => d.supplierId,
    );
    const productIds = pick(
      (d) => d.referenceType === OpeningBalanceReferenceType.INVENTORY,
      (d) => d.productId,
    );
    const warehouseIds = pick(
      (d) => d.referenceType === OpeningBalanceReferenceType.INVENTORY,
      (d) => d.warehouseId,
    );

    const [accounts, customers, suppliers, products, warehouses] =
      await Promise.all([
        accountIds.length
          ? this.accountRepository.find({ where: { id: In(accountIds) } })
          : [],
        customerIds.length
          ? this.customerRepository.find({ where: { id: In(customerIds) } })
          : [],
        supplierIds.length
          ? this.supplierRepository.find({ where: { id: In(supplierIds) } })
          : [],
        productIds.length
          ? this.productRepository.find({ where: { id: In(productIds) } })
          : [],
        warehouseIds.length
          ? this.warehouseRepository.find({ where: { id: In(warehouseIds) } })
          : [],
      ]);

    return {
      settings,
      accountsById: new Map(
        accounts.map((a): [string, ChartOfAccount] => [a.id, a]),
      ),
      customerIds: new Set(customers.map((c) => c.id)),
      supplierIds: new Set(suppliers.map((s) => s.id)),
      productsById: new Map(products.map((p): [string, Product] => [p.id, p])),
      warehouseIds: new Set(warehouses.map((w) => w.id)),
    };
  }

  /** Product override → settings by product type → null. */
  private resolveInventoryAccount(
    product: Product | undefined,
    settings: AccountingSetting | null,
  ): string | null {
    if (product?.inventoryAccountId) return product.inventoryAccountId;
    if (!settings) return null;
    return product?.productType === ProductType.RAW_MATERIAL
      ? settings.rawMaterialInventoryAccountId
      : settings.finishedGoodsInventoryAccountId;
  }

  // =========================================================
  // HELPERS
  // =========================================================
  /**
   * Load the operational entities a detail set references so cash/bank rows can
   * DERIVE their GL account + branch from the selected treasury/bank account,
   * and inventory rows can derive their branch from the warehouse.
   */
  private async loadDetailRefs(
    rows: OpeningBalanceDetailDto[],
  ): Promise<DetailRefs> {
    const treasuryIds = [
      ...new Set(rows.map((r) => r.treasuryId).filter((v): v is string => !!v)),
    ];
    const bankIds = [
      ...new Set(rows.map((r) => r.bankAccountId).filter((v): v is string => !!v)),
    ];
    const warehouseIds = [
      ...new Set(rows.map((r) => r.warehouseId).filter((v): v is string => !!v)),
    ];

    const [treasuries, banks, warehouses] = await Promise.all([
      treasuryIds.length
        ? this.treasuryRepository.find({ where: { id: In(treasuryIds) } })
        : [],
      bankIds.length
        ? this.bankAccountRepository.find({ where: { id: In(bankIds) } })
        : [],
      warehouseIds.length
        ? this.warehouseRepository.find({ where: { id: In(warehouseIds) } })
        : [],
    ]);

    return {
      treasuryById: new Map(
        treasuries.map((t): [string, { accountId: string; branchId: string }] => [
          t.id,
          { accountId: t.accountId, branchId: t.branchId },
        ]),
      ),
      bankById: new Map(
        banks.map((b): [string, { accountId: string; branchId: string }] => [
          b.id,
          { accountId: b.accountId, branchId: b.branchId },
        ]),
      ),
      warehouseBranchById: new Map(
        warehouses.map((w): [string, string] => [w.id, w.branchId]),
      ),
    };
  }

  private buildDetails(
    rows: OpeningBalanceDetailDto[],
    refs: DetailRefs,
  ): OpeningBalanceDetail[] {
    return rows.map((row, index) => {
      const detail = new OpeningBalanceDetail();
      detail.referenceType = row.referenceType;
      detail.lineNumber = index + 1;
      detail.accountId = row.accountId ?? null;
      detail.customerId = row.customerId ?? null;
      detail.supplierId = row.supplierId ?? null;
      detail.warehouseId = row.warehouseId ?? null;
      detail.productId = row.productId ?? null;
      detail.treasuryId = null;
      detail.bankAccountId = null;
      detail.branchId = null;
      detail.quantity = row.quantity ?? 0;
      detail.unitCost = row.unitCost ?? 0;
      detail.notes = row.notes ?? null;

      switch (row.referenceType) {
        case OpeningBalanceReferenceType.CASH: {
          // GL account + branch DERIVE from the treasury (lenient: an incomplete
          // draft may not have picked one yet — validation enforces it later).
          detail.treasuryId = row.treasuryId ?? null;
          const t = row.treasuryId ? refs.treasuryById.get(row.treasuryId) : undefined;
          detail.accountId = t?.accountId ?? null;
          detail.branchId = t?.branchId ?? null;
          detail.debit = row.debit ?? 0;
          detail.credit = row.credit ?? 0;
          break;
        }
        case OpeningBalanceReferenceType.BANK: {
          detail.bankAccountId = row.bankAccountId ?? null;
          const b = row.bankAccountId ? refs.bankById.get(row.bankAccountId) : undefined;
          detail.accountId = b?.accountId ?? null;
          detail.branchId = b?.branchId ?? null;
          detail.debit = row.debit ?? 0;
          detail.credit = row.credit ?? 0;
          break;
        }
        case OpeningBalanceReferenceType.INVENTORY: {
          detail.branchId = row.warehouseId
            ? refs.warehouseBranchById.get(row.warehouseId) ?? null
            : null;
          detail.debit = round2((row.quantity ?? 0) * (row.unitCost ?? 0));
          detail.credit = 0;
          break;
        }
        default: {
          // general_ledger
          detail.debit = row.debit ?? 0;
          detail.credit = row.credit ?? 0;
        }
      }
      detail.isSystemGenerated = false;
      return detail;
    });
  }

  /**
   * Build the user detail rows and, when auto-balancing is on, append exactly
   * ONE opening-balance-equity line for the debit/credit difference. Recomputed
   * on every save so it is never duplicated. When no equity account is
   * configured the line is skipped and validation surfaces the imbalance.
   */
  // =========================================================
  // ACCOUNTING IMPACT (shared by validate / post / preview)
  // =========================================================
  /** Run the shared accounting builder using an already-loaded context. */
  private buildImpact(
    openingBalance: OpeningBalance,
    ctx: OpeningContext,
  ): AccountingImpact {
    const details = openingBalance.details ?? [];
    const inventoryAccountByProductId = new Map<string, string | null>();
    for (const d of details) {
      if (d.referenceType === OpeningBalanceReferenceType.INVENTORY && d.productId) {
        inventoryAccountByProductId.set(
          d.productId,
          this.resolveInventoryAccount(
            ctx.productsById.get(d.productId),
            ctx.settings,
          ),
        );
      }
    }
    return this.accountingBuilder.build({
      details,
      autoBalance: openingBalance.autoBalance,
      customerControlAccountId: ctx.settings?.customerControlAccountId ?? null,
      supplierControlAccountId: ctx.settings?.supplierControlAccountId ?? null,
      equityAccountId: ctx.settings?.openingBalanceEquityAccountId ?? null,
      inventoryAccountByProductId,
    });
  }

  /**
   * Read-only journal preview: the exact accounting result that posting will
   * produce, aggregated by account and enriched with account code/name.
   */
  async journalPreview(id: string): Promise<JournalPreview> {
    const openingBalance = await this.findOne(id);
    const ctx = await this.loadContext(openingBalance.details ?? []);
    const impact = this.buildImpact(openingBalance, ctx);

    const info = await this.loadAccountInfo(
      impact.journalLines.map((l) => l.accountId),
    );
    const toLine = (l: AccountingImpact['journalLines'][number]): PreviewLine => ({
      accountId: l.accountId,
      accountCode: info.get(l.accountId)?.code ?? '',
      accountName: info.get(l.accountId)?.name ?? l.accountId,
      debit: l.debit,
      credit: l.credit,
      isSystemGenerated: l.isSystemGenerated,
    });

    const balancingLine = impact.balancingLine ? toLine(impact.balancingLine) : null;
    return {
      journalLines: impact.journalLines.map(toLine),
      rawTotals: {
        debit: impact.rawDebit,
        credit: impact.rawCredit,
        difference: impact.rawDifference,
      },
      balancingLine,
      balancingAccount: balancingLine
        ? {
            id: balancingLine.accountId,
            code: balancingLine.accountCode,
            name: balancingLine.accountName,
          }
        : null,
      finalTotals: {
        debit: impact.finalDebit,
        credit: impact.finalCredit,
        difference: impact.difference,
      },
      autoBalance: openingBalance.autoBalance,
      isBalanced: impact.isBalanced,
    };
  }

  /** The posted journal entry (for "عرض القيد المحاسبي"). */
  async journalEntry(id: string): Promise<PostedJournalEntry> {
    const openingBalance = await this.findOne(id);
    if (!openingBalance.journalEntryId) {
      throw new BadRequestException('لا يوجد قيد محاسبي — لم يتم الترحيل بعد');
    }
    const entry = await this.journalEntryService.findWithLines(
      openingBalance.journalEntryId,
    );
    if (!entry) {
      throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
    }

    const info = await this.loadAccountInfo(entry.lines.map((l) => l.accountId));
    return {
      entryNumber: entry.entryNumber ?? '',
      entryDate: entry.entryDate,
      accountingPeriodId: entry.accountingPeriodId,
      sourceType: entry.sourceType,
      description: entry.description,
      lines: entry.lines.map((l) => ({
        accountId: l.accountId,
        accountCode: info.get(l.accountId)?.code ?? '',
        accountName: info.get(l.accountId)?.name ?? l.accountId,
        debit: l.debit,
        credit: l.credit,
        isSystemGenerated: false,
      })),
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
    };
  }

  private async loadAccountInfo(
    ids: string[],
  ): Promise<Map<string, { code: string; name: string }>> {
    const unique = [...new Set(ids)];
    const accounts = unique.length
      ? await this.accountRepository.find({ where: { id: In(unique) } })
      : [];
    return new Map(
      accounts.map((a): [string, { code: string; name: string }] => [
        a.id,
        {
          code: a.accountCode,
          name: `${a.accountCode} - ${a.accountNameAr}`,
        },
      ]),
    );
  }

  private assertNotPosted(openingBalance: OpeningBalance): void {
    if (openingBalance.posted) {
      throw new BadRequestException(
        'الرصيد الافتتاحي مُرحّل ولا يمكن تعديله',
      );
    }
  }

  private async getCompany(): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!company) {
      throw new BadRequestException('يجب إعداد بيانات الشركة أولاً');
    }
    return company;
  }

  private async getFiscalYear(id: string): Promise<FiscalYear> {
    const fiscalYear = await this.fiscalYearRepository.findOne({ where: { id } });
    if (!fiscalYear) {
      throw new NotFoundException('السنة المالية غير موجودة');
    }
    return fiscalYear;
  }

  private async getPeriod(
    id: string,
    fiscalYearId: string,
  ): Promise<AccountingPeriod> {
    const period = await this.periodRepository.findOne({ where: { id } });
    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة');
    }
    if (period.fiscalYearId !== fiscalYearId) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
    return period;
  }

  private async ensureAccountingSettingsExist(): Promise<void> {
    const settings = await this.settingRepository.findOne({ where: {} });
    if (!settings) {
      throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
    }
  }

  private assertDateInFiscalYear(date: string, fiscalYear: FiscalYear): void {
    if (!this.isDateInFiscalYear(date, fiscalYear)) {
      throw new BadRequestException('تاريخ الافتتاح خارج نطاق السنة المالية');
    }
  }

  private isDateInFiscalYear(date: string, fiscalYear: FiscalYear): boolean {
    const d = new Date(date).getTime();
    return (
      d >= new Date(fiscalYear.startDate).getTime() &&
      d <= new Date(fiscalYear.endDate).getTime()
    );
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
