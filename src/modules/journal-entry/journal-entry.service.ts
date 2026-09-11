import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { SequenceService } from '../sequence/sequence.service';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import {
  JournalEntryStatus,
  JournalSourceType,
  isSystemSourceType,
} from './enums/journal-entry.enum';
import {
  assertPostable,
  buildReversalLines,
  computeTotals,
  JournalLineInput,
  PostableAccount,
  round2,
  validateAccounts,
  validateLineShapes,
} from './journal-entry.rules';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { ReverseJournalEntryDto } from './dto/reverse-journal-entry.dto';
import { JournalEntryQueryDto } from './dto/journal-entry-query.dto';

export type { JournalLineInput } from './journal-entry.rules';

/** Everything a system module needs to post one balanced entry. */
export interface CreateSystemJournalEntryInput {
  sourceType: JournalSourceType | string;
  sourceId?: string | null;
  sourceNumber?: string | null;
  entryDate: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  branchId?: string | null;
  description: string;
  lines: JournalLineInput[];
  actorId?: string | null;
  reversalOfJournalEntryId?: string | null;
}

/** A row in the journal-entry list (enriched with the period name). */
export interface JournalEntryListItem {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  status: JournalEntryStatus;
  accountingPeriodId: string;
  accountingPeriodName: string | null;
  branchId: string | null;
  totalDebit: number;
  totalCredit: number;
}

/** One journal line enriched with account code/name for display. */
export interface DetailedLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
}

/** Full details view of a journal entry (header + enriched lines + links). */
export interface JournalEntryDetail {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  status: JournalEntryStatus;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  isSystemGenerated: boolean;
  description: string | null;
  fiscalYearId: string;
  fiscalYearName: string | null;
  accountingPeriodId: string;
  accountingPeriodName: string | null;
  branchId: string | null;
  branchName: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: DetailedLine[];
  createdAt: Date;
  createdByName: string | null;
  postedAt: Date | null;
  postedByName: string | null;
  reversedAt: Date | null;
  reversedByName: string | null;
  reversalReason: string | null;
  /** The reversal entry created against this one (this entry is REVERSED). */
  reversalEntry: { id: string; entryNumber: string | null } | null;
  /** The original entry this one reverses (this entry IS a reversal). */
  reversalOfEntry: { id: string; entryNumber: string | null } | null;
}

/**
 * The central accounting engine and Journal Entries feature service.
 *
 *  - {@link createSystemJournalEntry} is the ONE way any module posts to the
 *    ledger: it owns numbering, fiscal-year/period validation, account and
 *    line validation, server-side totals and the double-entry invariant, and
 *    always joins the caller's transaction. It is not exposed over HTTP.
 *  - The remaining methods implement the manual Journal Entries UI (CRUD, post,
 *    reverse, copy, list, details).
 */
@Injectable()
export class JournalEntryService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entryRepository: Repository<JournalEntry>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly sequence: SequenceService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // CENTRAL ENGINE (internal — reused by every posting module)
  // =========================================================
  /**
   * Post one balanced journal entry inside the caller's transaction. Validates
   * period/date, accounts, line shapes and balance, mints the entry number and
   * persists it as POSTED. Throws (rolling back the caller) on any violation.
   */
  async createSystemJournalEntry(
    input: CreateSystemJournalEntryInput,
    manager: EntityManager,
  ): Promise<JournalEntry> {
    const lines = input.lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
    validateLineShapes(lines);

    const { fiscalYear } = await this.assertPostingContext(
      input.fiscalYearId,
      input.accountingPeriodId,
      input.entryDate,
      manager,
    );

    const accounts = await this.loadPostableAccounts(
      lines.map((l) => l.accountId),
      manager,
    );
    validateAccounts(lines, accounts);

    const { totalDebit, totalCredit } = computeTotals(lines);
    assertPostable(totalDebit, totalCredit);

    const entryNumber = await this.sequence.nextJournalNumber(fiscalYear, manager);

    return this.persistEntry(manager, {
      entryNumber,
      entryDate: input.entryDate,
      fiscalYearId: input.fiscalYearId,
      accountingPeriodId: input.accountingPeriodId,
      branchId: input.branchId ?? null,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceNumber: input.sourceNumber ?? null,
      reversalOfJournalEntryId: input.reversalOfJournalEntryId ?? null,
      status: JournalEntryStatus.POSTED,
      isPosted: true,
      totalDebit,
      totalCredit,
      postedAt: new Date(),
      postedBy: input.actorId ?? null,
      createdBy: input.actorId ?? null,
      lines,
    });
  }

  /**
   * Mark an already-posted entry as REVERSED and link it to the reversal entry
   * that was created against it. Used by source modules (e.g. opening balances)
   * that create their reversal entry themselves but still own this lifecycle
   * transition. Joins the caller's transaction.
   */
  async markEntryReversed(
    originalId: string,
    reversalEntryId: string,
    reason: string,
    actorId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(JournalEntry).update(originalId, {
      status: JournalEntryStatus.REVERSED,
      reversalJournalEntryId: reversalEntryId,
      reversedAt: new Date(),
      reversedBy: actorId ?? null,
      reversalReason: reason,
      updatedBy: actorId ?? null,
    });
  }

  /** Load a journal entry with its lines (ordered). Read-only source of truth. */
  findWithLines(id: string): Promise<JournalEntry | null> {
    return this.entryRepository.findOne({
      where: { id },
      relations: { lines: true },
      order: { lines: { lineNumber: 'ASC' } },
    });
  }

  // =========================================================
  // LIST + DETAILS
  // =========================================================
  async findAll(
    query: JournalEntryQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<JournalEntryListItem>> {
    const qb = this.entryRepository.createQueryBuilder('je');
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'je.branchId', branchScope);

    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('je.entryNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('je.description LIKE :s', { s: `%${query.search}%` })
            .orWhere('je.sourceNumber LIKE :s', { s: `%${query.search}%` });
        }),
      );
    }
    if (query.fiscalYearId) {
      qb.andWhere('je.fiscalYearId = :fy', { fy: query.fiscalYearId });
    }
    if (query.accountingPeriodId) {
      qb.andWhere('je.accountingPeriodId = :ap', { ap: query.accountingPeriodId });
    }
    if (query.branchId) {
      qb.andWhere('je.branchId = :br', { br: query.branchId });
    }
    if (query.status) {
      qb.andWhere('je.status = :st', { st: query.status });
    }
    if (query.sourceType) {
      qb.andWhere('je.sourceType = :src', { src: query.sourceType });
    }
    if (query.dateFrom) {
      qb.andWhere('je.entryDate >= :df', { df: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('je.entryDate <= :dt', { dt: query.dateTo });
    }

    qb.orderBy('je.entryDate', 'DESC')
      .addOrderBy('je.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.perPage);

    const [items, total] = await qb.getManyAndCount();

    const periodIds = [...new Set(items.map((e) => e.accountingPeriodId))];
    const periods = periodIds.length
      ? await this.periodRepository.find({ where: { id: In(periodIds) } })
      : [];
    const periodName = new Map(
      periods.map((p): [string, string] => [p.id, p.name]),
    );

    const rows: JournalEntryListItem[] = items.map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      entryDate: e.entryDate,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceNumber: e.sourceNumber,
      status: e.status,
      accountingPeriodId: e.accountingPeriodId,
      accountingPeriodName: periodName.get(e.accountingPeriodId) ?? null,
      branchId: e.branchId,
      totalDebit: e.totalDebit,
      totalCredit: e.totalCredit,
    }));

    return paginate(rows, total, query.page, query.perPage);
  }

  /** Enriched details for the view page. */
  async findOneDetailed(
    id: string,
    branchScope: BranchScope = null,
  ): Promise<JournalEntryDetail> {
    const entry = await this.findWithLines(id);
    if (!entry || !isWithinBranchScope(entry.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
    }

    const accountInfo = await this.loadAccountInfo(
      entry.lines.map((l) => l.accountId),
    );

    const [fiscalYear, period, branch, users, reversalEntry, reversalOfEntry] =
      await Promise.all([
        this.fiscalYearRepository.findOne({ where: { id: entry.fiscalYearId } }),
        this.periodRepository.findOne({ where: { id: entry.accountingPeriodId } }),
        entry.branchId
          ? this.branchRepository.findOne({ where: { id: entry.branchId } })
          : null,
        this.loadUserNames([entry.createdBy, entry.postedBy, entry.reversedBy]),
        entry.reversalJournalEntryId
          ? this.entryRepository.findOne({
              where: { id: entry.reversalJournalEntryId },
              select: { id: true, entryNumber: true },
            })
          : null,
        entry.reversalOfJournalEntryId
          ? this.entryRepository.findOne({
              where: { id: entry.reversalOfJournalEntryId },
              select: { id: true, entryNumber: true },
            })
          : null,
      ]);

    return {
      id: entry.id,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      status: entry.status,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceNumber: entry.sourceNumber,
      isSystemGenerated: isSystemSourceType(entry.sourceType),
      description: entry.description,
      fiscalYearId: entry.fiscalYearId,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodId: entry.accountingPeriodId,
      accountingPeriodName: period?.name ?? null,
      branchId: entry.branchId,
      branchName: branch?.name ?? null,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      lines: entry.lines.map((l) => ({
        accountId: l.accountId,
        accountCode: accountInfo.get(l.accountId)?.code ?? '',
        accountName: accountInfo.get(l.accountId)?.name ?? l.accountId,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      })),
      createdAt: entry.createdAt,
      createdByName: users.get(entry.createdBy ?? '') ?? null,
      postedAt: entry.postedAt,
      postedByName: users.get(entry.postedBy ?? '') ?? null,
      reversedAt: entry.reversedAt,
      reversedByName: users.get(entry.reversedBy ?? '') ?? null,
      reversalReason: entry.reversalReason,
      reversalEntry: reversalEntry
        ? { id: reversalEntry.id, entryNumber: reversalEntry.entryNumber }
        : null,
      reversalOfEntry: reversalOfEntry
        ? { id: reversalOfEntry.id, entryNumber: reversalOfEntry.entryNumber }
        : null,
    };
  }

  // =========================================================
  // MANUAL: CREATE / UPDATE / DELETE
  // =========================================================
  async createManual(
    dto: CreateJournalEntryDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<JournalEntry> {
    await this.assertPeriodBelongsToYear(dto.fiscalYearId, dto.accountingPeriodId);
    const lines = this.toLineInputs(dto.lines);
    const { totalDebit, totalCredit } = computeTotals(lines);

    return this.persistEntry(this.entryRepository.manager, {
      entryNumber: null,
      entryDate: dto.entryDate,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: resolveWriteBranch(branchScope, dto.branchId),
      description: dto.description ?? null,
      sourceType: JournalSourceType.MANUAL,
      sourceId: null,
      sourceNumber: null,
      reversalOfJournalEntryId: null,
      status: JournalEntryStatus.DRAFT,
      isPosted: false,
      totalDebit,
      totalCredit,
      postedAt: null,
      postedBy: null,
      createdBy: actorId ?? null,
      lines,
    });
  }

  async updateManual(
    id: string,
    dto: UpdateJournalEntryDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<JournalEntry> {
    const entry = await this.getEditableDraft(id, branchScope);

    if (dto.entryDate) entry.entryDate = dto.entryDate;
    if (dto.fiscalYearId) entry.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) entry.accountingPeriodId = dto.accountingPeriodId;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope !== null) entry.branchId = resolveWriteBranch(branchScope, entry.branchId);
    else if (dto.branchId !== undefined) entry.branchId = dto.branchId ?? null;
    if (dto.description !== undefined) entry.description = dto.description ?? null;
    await this.assertPeriodBelongsToYear(
      entry.fiscalYearId,
      entry.accountingPeriodId,
    );

    return this.dataSource.transaction(async (manager) => {
      if (dto.lines) {
        await manager.delete(JournalEntryLine, { journalEntryId: id });
        const lines = this.toLineInputs(dto.lines);
        const totals = computeTotals(lines);
        entry.totalDebit = totals.totalDebit;
        entry.totalCredit = totals.totalCredit;
        entry.lines = lines.map((line, index) =>
          this.newLine(line, index, entry.branchId),
        );
      }
      entry.updatedBy = actorId ?? null;
      return manager.getRepository(JournalEntry).save(entry);
    });
  }

  async remove(
    id: string,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.entryRepository.update(id, { deletedBy: actorId ?? null });
    await this.entryRepository.softDelete(id);
  }

  // =========================================================
  // MANUAL: POST
  // =========================================================
  async post(id: string, actorId?: string, branchScope: BranchScope = null): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const entry = await this.lockEntry(manager, id);
      if (!isWithinBranchScope(entry.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
      }
      if (entry.sourceType !== JournalSourceType.MANUAL) {
        throw new BadRequestException(
          'القيود المولّدة من مستندات أخرى تُرحّل من مستندها المصدر',
        );
      }
      if (entry.status !== JournalEntryStatus.DRAFT) {
        throw new BadRequestException('لا يمكن ترحيل قيد غير مسودة');
      }

      const lines = this.toLineInputs(entry.lines);
      if (lines.length < 2) {
        throw new BadRequestException('يجب أن يحتوي القيد على بندين على الأقل');
      }
      validateLineShapes(lines);

      const { fiscalYear } = await this.assertPostingContext(
        entry.fiscalYearId,
        entry.accountingPeriodId,
        entry.entryDate,
        manager,
      );
      const accounts = await this.loadPostableAccounts(
        lines.map((l) => l.accountId),
        manager,
      );
      validateAccounts(lines, accounts);

      const { totalDebit, totalCredit } = computeTotals(lines);
      assertPostable(totalDebit, totalCredit);

      entry.entryNumber = await this.sequence.nextJournalNumber(fiscalYear, manager);
      entry.status = JournalEntryStatus.POSTED;
      entry.isPosted = true;
      entry.totalDebit = totalDebit;
      entry.totalCredit = totalCredit;
      entry.postedAt = new Date();
      entry.postedBy = actorId ?? null;
      entry.updatedBy = actorId ?? null;

      return manager.getRepository(JournalEntry).save(entry);
    });
  }

  // =========================================================
  // MANUAL: REVERSE
  // =========================================================
  async reverse(
    id: string,
    dto: ReverseJournalEntryDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<JournalEntry> {
    return this.dataSource.transaction(async (manager) => {
      const original = await this.lockEntry(manager, id);
      if (!isWithinBranchScope(original.branchId, branchScope)) {
        throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
      }

      if (isSystemSourceType(original.sourceType)) {
        throw new BadRequestException(
          'يجب عكس القيد من المستند المصدر وليس من شاشة القيود',
        );
      }
      if (original.status === JournalEntryStatus.REVERSED) {
        throw new ConflictException('القيد معكوس بالفعل');
      }
      if (original.status !== JournalEntryStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس قيد غير مُرحّل');
      }

      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(
        dto.reversalDate,
        period.startDate,
        period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة',
      );

      const reversalLines = buildReversalLines(this.toLineInputs(original.lines));

      const reversal = await this.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.MANUAL,
          sourceId: null,
          sourceNumber: original.entryNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: original.branchId,
          description: `عكس القيد ${original.entryNumber ?? ''} — ${dto.reason}`,
          lines: reversalLines,
          actorId,
          reversalOfJournalEntryId: original.id,
        },
        manager,
      );

      await this.markEntryReversed(original.id, reversal.id, dto.reason, actorId, manager);

      return manager.getRepository(JournalEntry).findOneOrFail({ where: { id } });
    });
  }

  // =========================================================
  // MANUAL: COPY TO DRAFT
  // =========================================================
  async copy(id: string, actorId?: string): Promise<JournalEntry> {
    const source = await this.findWithLines(id);
    if (!source) {
      throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
    }
    if (source.sourceType !== JournalSourceType.MANUAL) {
      throw new BadRequestException('يمكن نسخ القيود اليدوية فقط');
    }

    const lines = this.toLineInputs(source.lines);
    const { totalDebit, totalCredit } = computeTotals(lines);

    return this.persistEntry(this.entryRepository.manager, {
      entryNumber: null,
      entryDate: source.entryDate,
      fiscalYearId: source.fiscalYearId,
      accountingPeriodId: source.accountingPeriodId,
      branchId: source.branchId,
      description: source.description,
      sourceType: JournalSourceType.MANUAL,
      sourceId: null,
      sourceNumber: null,
      reversalOfJournalEntryId: null,
      status: JournalEntryStatus.DRAFT,
      isPosted: false,
      totalDebit,
      totalCredit,
      postedAt: null,
      postedBy: null,
      createdBy: actorId ?? null,
      lines,
    });
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async persistEntry(
    manager: EntityManager,
    data: {
      entryNumber: string | null;
      entryDate: string;
      fiscalYearId: string;
      accountingPeriodId: string;
      branchId: string | null;
      description: string | null;
      sourceType: string;
      sourceId: string | null;
      sourceNumber: string | null;
      reversalOfJournalEntryId: string | null;
      status: JournalEntryStatus;
      isPosted: boolean;
      totalDebit: number;
      totalCredit: number;
      postedAt: Date | null;
      postedBy: string | null;
      createdBy: string | null;
      lines: JournalLineInput[];
    },
  ): Promise<JournalEntry> {
    const repo = manager.getRepository(JournalEntry);
    const entry = repo.create({
      entryNumber: data.entryNumber,
      entryDate: data.entryDate,
      fiscalYearId: data.fiscalYearId,
      accountingPeriodId: data.accountingPeriodId,
      branchId: data.branchId,
      description: data.description,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      sourceNumber: data.sourceNumber,
      reversalOfJournalEntryId: data.reversalOfJournalEntryId,
      status: data.status,
      isPosted: data.isPosted,
      totalDebit: data.totalDebit,
      totalCredit: data.totalCredit,
      postedAt: data.postedAt,
      postedBy: data.postedBy,
      createdBy: data.createdBy,
      lines: data.lines.map((line, index) =>
        this.newLine(line, index, data.branchId),
      ),
    });
    return repo.save(entry);
  }

  private newLine(
    line: JournalLineInput,
    index: number,
    fallbackBranchId: string | null = null,
  ): JournalEntryLine {
    const entity = new JournalEntryLine();
    entity.accountId = line.accountId;
    entity.lineNumber = index + 1;
    entity.debit = round2(line.debit || 0);
    entity.credit = round2(line.credit || 0);
    entity.description = line.description ?? null;
    // Line branch overrides the entry branch; entry branch is the fallback.
    entity.branchId = line.branchId ?? fallbackBranchId ?? null;
    entity.customerId = line.customerId ?? null;
    entity.supplierId = line.supplierId ?? null;
    entity.warehouseId = line.warehouseId ?? null;
    entity.productId = line.productId ?? null;
    return entity;
  }

  private toLineInputs(
    lines: Array<Partial<JournalLineInput> & { accountId: string }>,
  ): JournalLineInput[] {
    return lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      description: l.description ?? null,
      customerId: l.customerId ?? null,
      supplierId: l.supplierId ?? null,
      warehouseId: l.warehouseId ?? null,
      productId: l.productId ?? null,
    }));
  }

  private async lockEntry(
    manager: EntityManager,
    id: string,
  ): Promise<JournalEntry> {
    const entry = await manager.findOne(JournalEntry, {
      where: { id },
      relations: { lines: true },
      order: { lines: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!entry) {
      throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
    }
    return entry;
  }

  private async getEditableDraft(
    id: string,
    branchScope: BranchScope = null,
  ): Promise<JournalEntry> {
    const entry = await this.findWithLines(id);
    if (!entry || !isWithinBranchScope(entry.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على القيد المحاسبي');
    }
    if (entry.sourceType !== JournalSourceType.MANUAL) {
      throw new BadRequestException(
        'القيود المولّدة من مستندات أخرى غير قابلة للتعديل أو الحذف',
      );
    }
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        'القيد مُرحّل أو معكوس ولا يمكن تعديله أو حذفه',
      );
    }
    return entry;
  }

  private async assertPostingContext(
    fiscalYearId: string,
    accountingPeriodId: string,
    entryDate: string,
    manager: EntityManager,
  ): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({
      where: { id: fiscalYearId },
    });
    if (!fiscalYear) {
      throw new NotFoundException('السنة المالية غير موجودة');
    }
    if (fiscalYear.isClosed) {
      throw new BadRequestException('السنة المالية مغلقة');
    }

    const period = await manager.getRepository(AccountingPeriod).findOne({
      where: { id: accountingPeriodId },
    });
    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة');
    }
    if (period.fiscalYearId !== fiscalYear.id) {
      throw new BadRequestException(
        'الفترة المحاسبية لا تتبع السنة المالية المختارة',
      );
    }
    if (period.isClosed) {
      throw new BadRequestException('لا يمكن الترحيل إلى فترة محاسبية مغلقة');
    }

    this.assertDateWithin(
      entryDate,
      fiscalYear.startDate,
      fiscalYear.endDate,
      'تاريخ القيد خارج نطاق السنة المالية',
    );
    this.assertDateWithin(
      entryDate,
      period.startDate,
      period.endDate,
      'تاريخ القيد خارج نطاق الفترة المحاسبية',
    );

    return { fiscalYear, period };
  }

  private async assertPeriodBelongsToYear(
    fiscalYearId: string,
    accountingPeriodId: string,
  ): Promise<void> {
    const period = await this.periodRepository.findOne({
      where: { id: accountingPeriodId },
    });
    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة');
    }
    if (period.fiscalYearId !== fiscalYearId) {
      throw new BadRequestException(
        'الفترة المحاسبية لا تتبع السنة المالية المختارة',
      );
    }
  }

  private async getOpenPeriod(
    id: string,
    manager: EntityManager,
  ): Promise<AccountingPeriod> {
    const period = await manager.getRepository(AccountingPeriod).findOne({
      where: { id },
    });
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

  private assertDateWithin(
    date: string,
    start: string,
    end: string,
    message: string,
  ): void {
    const d = new Date(date).getTime();
    if (d < new Date(start).getTime() || d > new Date(end).getTime()) {
      throw new BadRequestException(message);
    }
  }

  private async loadPostableAccounts(
    accountIds: string[],
    manager: EntityManager,
  ): Promise<Map<string, PostableAccount>> {
    const unique = [...new Set(accountIds)];
    const rows = unique.length
      ? await manager.getRepository(ChartOfAccount).find({
          where: { id: In(unique) },
        })
      : [];
    return new Map(
      rows.map((a): [string, PostableAccount] => [
        a.id,
        {
          id: a.id,
          isActive: a.isActive,
          allowPosting: a.allowPosting,
          isHeader: a.isHeader,
          name: a.accountNameAr,
        },
      ]),
    );
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
        { code: a.accountCode, name: `${a.accountCode} - ${a.accountNameAr}` },
      ]),
    );
  }

  private async loadUserNames(
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    const users = unique.length
      ? await this.userRepository.find({ where: { id: In(unique) } })
      : [];
    return new Map(users.map((u): [string, string] => [u.id, u.fullName]));
  }
}
