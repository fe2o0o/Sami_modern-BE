import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ChartOfAccount } from './entities/chart-of-account.entity';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { QueryChartOfAccountDto } from './dto/query-chart-of-account.dto';
import {
  AccountNature,
  AccountSubType,
  AccountType,
  ACCOUNT_NATURE_LABELS,
  ACCOUNT_SUBTYPE_LABELS,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_NATURE_BY_TYPE,
} from './enums/account.enum';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool, enumFromLabel } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'accountCode', header: 'كود الحساب', required: true, example: '111105', note: 'كود فريد' },
  { field: 'accountNameAr', header: 'اسم الحساب', required: true, example: 'خزينة الفرع' },
  { field: 'accountNameEn', header: 'الاسم بالإنجليزية', example: 'Branch Treasury' },
  { field: 'accountType', header: 'نوع الحساب', example: 'الأصول', note: 'الأصول/الخصوم/حقوق الملكية/الإيرادات/المصروفات — يُورَث من الأب إن تُرك فارغاً' },
  { field: 'accountNature', header: 'طبيعة الحساب', example: 'مدين', note: 'مدين/دائن (افتراضي حسب النوع)' },
  { field: 'accountSubType', header: 'التصنيف التفصيلي', example: 'نقدية / خزينة', note: 'اختياري — يُورَث من الأب إن تُرك فارغاً' },
  { field: 'parentCode', header: 'كود الحساب الأب', example: '111100', note: 'اتركه فارغاً للحساب الرئيسي. يجب أن يظهر الأب قبل أبنائه.' },
  { field: 'isHeader', header: 'حساب رئيسي', type: 'boolean', example: 'لا', note: 'نعم/لا (الحساب الرئيسي لا يقبل الترحيل)' },
  { field: 'allowPosting', header: 'يقبل الترحيل', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم للحساب الفرعي)' },
];

/** Account node with its nested children (tree mode). */
export interface AccountTreeNode extends ChartOfAccount {
  children: AccountTreeNode[];
}

export interface ChartOfAccountSummary {
  totalAccounts: number;
  headerAccounts: number;
  postingAccounts: number;
  activeAccounts: number;
  inactiveAccounts: number;
  byType: Record<AccountType, number>;
}

@Injectable()
export class ChartOfAccountService {
  constructor(
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    private readonly dataSource: DataSource,
    private readonly excel: ExcelService,
    imports: ImportRegistry,
  ) {
    imports.register('chart-of-accounts', {
      templateFilename: 'chart-of-accounts-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'دليل الحسابات',
      title: 'استيراد دليل الحسابات',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const repo = manager.getRepository(ChartOfAccount);
      const code = str(v.accountCode, 'كود الحساب');
      if (seen.has(code)) throw new Error(`كود الحساب «${code}» مكرر داخل الملف`);
      seen.add(code);
      if (await repo.findOne({ where: { accountCode: code }, withDeleted: true })) {
        throw new Error(`كود الحساب «${code}» مستخدم بالفعل`);
      }

      // Resolve parent (must already exist — earlier in the file or in the DB).
      let parent: ChartOfAccount | null = null;
      let level = 1;
      const parentCode = optStr(v.parentCode);
      if (parentCode) {
        parent = await repo.findOne({ where: { accountCode: parentCode } });
        if (!parent) {
          throw new Error(
            `الحساب الأب بكود «${parentCode}» غير موجود — تأكد أنه مُدرج قبل هذا الصف`,
          );
        }
        level = parent.level + 1;
      }

      // Type inherits the parent's when blank; nature defaults from the type.
      const typeRaw = optStr(v.accountType);
      const accountType = typeRaw
        ? enumFromLabel<AccountType>(typeRaw, ACCOUNT_TYPE_LABELS, 'نوع الحساب')
        : parent?.accountType;
      if (!accountType) {
        throw new Error('نوع الحساب مطلوب (أو حدّد حساباً أباً يُورَث منه)');
      }
      const natureRaw = optStr(v.accountNature);
      const accountNature = natureRaw
        ? enumFromLabel<AccountNature>(natureRaw, ACCOUNT_NATURE_LABELS, 'طبيعة الحساب')
        : DEFAULT_NATURE_BY_TYPE[accountType];

      const subTypeRaw = optStr(v.accountSubType);
      const accountSubType = subTypeRaw
        ? enumFromLabel<AccountSubType>(subTypeRaw, ACCOUNT_SUBTYPE_LABELS, 'التصنيف التفصيلي')
        : (parent?.accountSubType ?? null);

      const isHeader = bool(v.isHeader, false);
      const allowPosting = isHeader ? false : bool(v.allowPosting, true);

      // A referenced parent can never be a posting leaf.
      if (parent && (parent.allowPosting || !parent.isHeader)) {
        parent.isHeader = true;
        parent.allowPosting = false;
        await repo.save(parent);
      }

      await repo.save(
        repo.create({
          accountCode: code,
          accountNameAr: str(v.accountNameAr, 'اسم الحساب'),
          accountNameEn: optStr(v.accountNameEn) ?? undefined,
          accountType,
          accountNature,
          accountSubType,
          parentId: parent?.id ?? null,
          level,
          isHeader,
          allowPosting,
          isActive: true,
        }),
      );
    });
  }

  // =========================
  // CREATE
  // =========================
  async create(
    dto: CreateChartOfAccountDto,
    actorId?: string,
  ): Promise<ChartOfAccount> {
    await this.ensureCodeUnique(dto.accountCode);
    this.assertFlagsNotConflicting(dto.isHeader, dto.allowPosting);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ChartOfAccount);

      let level = 1;
      let parent: ChartOfAccount | null = null;

      if (dto.parentId) {
        parent = await repo.findOne({ where: { id: dto.parentId } });
        if (!parent) {
          throw new NotFoundException('لم يتم العثور على الحساب الأب');
        }
        level = parent.level + 1;

        // Only leaf accounts may post — the parent becomes a header account.
        if (parent.allowPosting || !parent.isHeader) {
          parent.isHeader = true;
          parent.allowPosting = false;
          parent.updatedBy = actorId ?? null;
          await repo.save(parent);
        }
      }

      const isHeader = dto.isHeader ?? false;
      const allowPosting = isHeader ? false : (dto.allowPosting ?? true);

      // A child account inherits its parent's classification (type/sub-type)
      // unless explicitly overridden — so, e.g., every account under a CASH
      // parent is itself CASH and shows up in the treasury/bank pickers.
      const accountType = dto.accountType ?? parent?.accountType;
      const accountSubType =
        dto.accountSubType !== undefined && dto.accountSubType !== null
          ? dto.accountSubType
          : (parent?.accountSubType ?? null);

      const account = repo.create({
        ...dto,
        accountType,
        accountSubType,
        parentId: dto.parentId ?? null,
        level,
        isHeader,
        allowPosting,
        isActive: dto.isActive ?? true,
        createdBy: actorId ?? null,
      });

      return repo.save(account);
    });
  }

  // =========================
  // LIST (flat, paginated)
  // =========================
  async findAll(
    query: QueryChartOfAccountDto,
  ): Promise<PaginatedResult<ChartOfAccount>> {
    const qb = this.buildFilteredQuery(query);

    const sortBy = query.sortBy ?? 'accountCode';
    qb.orderBy(`account.${sortBy}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  // =========================
  // TREE
  // =========================
  async tree(query?: QueryChartOfAccountDto): Promise<AccountTreeNode[]> {
    const qb = this.buildFilteredQuery(query);
    qb.orderBy('account.accountCode', 'ASC');
    const accounts = await qb.getMany();
    return this.buildTree(accounts);
  }

  // =========================
  // GET ONE
  // =========================
  async findOne(id: string): Promise<ChartOfAccount> {
    const account = await this.accountRepository.findOne({
      where: { id },
      relations: { parent: true, children: true },
    });
    if (!account) {
      throw new NotFoundException('لم يتم العثور على الحساب');
    }
    return account;
  }

  /** Direct children of an account, ordered by code. */
  findChildren(parentId: string): Promise<ChartOfAccount[]> {
    return this.accountRepository.find({
      where: { parentId },
      order: { accountCode: 'ASC' },
    });
  }

  // =========================
  // UPDATE
  // =========================
  async update(
    id: string,
    dto: UpdateChartOfAccountDto,
    actorId?: string,
  ): Promise<ChartOfAccount> {
    const account = await this.getEntity(id);

    if (dto.accountCode && dto.accountCode !== account.accountCode) {
      await this.ensureCodeUnique(dto.accountCode, id);
    }
    this.assertFlagsNotConflicting(dto.isHeader, dto.allowPosting);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ChartOfAccount);
      const childCount = await repo.count({ where: { parentId: id } });

      // Re-parenting: guard against cycles and recompute the subtree levels.
      let levelChanged = false;
      if (dto.parentId !== undefined && dto.parentId !== account.parentId) {
        if (dto.parentId === id) {
          throw new BadRequestException('لا يمكن جعل الحساب أباً لنفسه');
        }
        let newLevel = 1;
        if (dto.parentId) {
          const parent = await repo.findOne({ where: { id: dto.parentId } });
          if (!parent) {
            throw new NotFoundException('لم يتم العثور على الحساب الأب');
          }
          await this.assertNotDescendant(repo, id, dto.parentId);
          newLevel = parent.level + 1;

          if (parent.allowPosting || !parent.isHeader) {
            parent.isHeader = true;
            parent.allowPosting = false;
            await repo.save(parent);
          }
        }
        account.parentId = dto.parentId ?? null;
        account.level = newLevel;
        levelChanged = true;
      }

      // A parent account can never be a posting account.
      let isHeader = dto.isHeader ?? account.isHeader;
      let allowPosting = dto.allowPosting ?? account.allowPosting;
      if (childCount > 0) {
        isHeader = true;
        allowPosting = false;
      } else if (isHeader) {
        allowPosting = false;
      } else if (allowPosting) {
        isHeader = false;
      }

      const { parentId: _p, isHeader: _h, allowPosting: _a, ...rest } = dto;
      Object.assign(account, rest, {
        isHeader,
        allowPosting,
        updatedBy: actorId ?? null,
      });

      const saved = await repo.save(account);
      if (levelChanged) {
        await this.recomputeDescendantLevels(repo, saved.id, saved.level);
      }
      return saved;
    });
  }

  // =========================
  // DELETE (soft)
  // =========================
  async remove(id: string, actorId?: string): Promise<void> {
    const account = await this.getEntity(id);

    if (account.isSystem) {
      throw new BadRequestException('لا يمكن حذف الحسابات الرئيسية الافتراضية');
    }

    const childCount = await this.accountRepository.count({
      where: { parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException('لا يمكن حذف حساب يحتوي على حسابات فرعية');
    }

    if (await this.isAccountUsed(id)) {
      throw new BadRequestException('لا يمكن حذف حساب مستخدم');
    }

    await this.accountRepository.update(id, { deletedBy: actorId ?? null });
    await this.accountRepository.softDelete(id);
  }

  // =========================
  // ACTIVATE / DEACTIVATE
  // =========================
  async toggleActive(id: string, actorId?: string): Promise<ChartOfAccount> {
    const account = await this.getEntity(id);
    account.isActive = !account.isActive;
    account.updatedBy = actorId ?? null;
    return this.accountRepository.save(account);
  }

  // =========================
  // SUMMARY (KPI cards)
  // =========================
  async summary(): Promise<ChartOfAccountSummary> {
    const accounts = await this.accountRepository.find({
      select: { id: true, isHeader: true, allowPosting: true, isActive: true, accountType: true },
    });

    const byType = Object.values(AccountType).reduce(
      (acc, type) => ({ ...acc, [type]: 0 }),
      {} as Record<AccountType, number>,
    );
    for (const account of accounts) {
      byType[account.accountType] += 1;
    }

    return {
      totalAccounts: accounts.length,
      headerAccounts: accounts.filter((a) => a.isHeader).length,
      postingAccounts: accounts.filter((a) => a.allowPosting).length,
      activeAccounts: accounts.filter((a) => a.isActive).length,
      inactiveAccounts: accounts.filter((a) => !a.isActive).length,
      byType,
    };
  }

  /** Lookup: active posting accounts only. */
  async postingAccounts(): Promise<{ id: string; name: string; accountCode: string }[]> {
    const rows = await this.accountRepository.find({
      where: { allowPosting: true, isActive: true },
      select: { id: true, accountCode: true, accountNameAr: true },
      order: { accountCode: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      accountCode: r.accountCode,
      name: `${r.accountCode} - ${r.accountNameAr}`,
    }));
  }

  // =========================================================
  // PRIVATE
  // =========================================================

  private buildFilteredQuery(query?: QueryChartOfAccountDto) {
    const qb = this.accountRepository.createQueryBuilder('account');

    if (query?.search) {
      qb.andWhere(
        '(account.accountCode LIKE :s OR account.accountNameAr LIKE :s OR account.accountNameEn LIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    if (query?.accountType) {
      qb.andWhere('account.accountType = :type', { type: query.accountType });
    }
    if (query?.allowPosting !== undefined) {
      qb.andWhere('account.allowPosting = :posting', { posting: query.allowPosting });
    }
    if (query?.isActive !== undefined) {
      qb.andWhere('account.isActive = :active', { active: query.isActive });
    }

    return qb;
  }

  /** Nest a flat list; orphans (parent filtered out) surface as roots. */
  private buildTree(accounts: ChartOfAccount[]): AccountTreeNode[] {
    const map = new Map<string, AccountTreeNode>();
    for (const account of accounts) {
      map.set(account.id, { ...account, children: [] } as AccountTreeNode);
    }

    const roots: AccountTreeNode[] = [];
    for (const node of map.values()) {
      const parent = node.parentId ? map.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  private async getEntity(id: string): Promise<ChartOfAccount> {
    const account = await this.accountRepository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('لم يتم العثور على الحساب');
    }
    return account;
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.accountRepository.findOne({
      where: { accountCode: code },
    });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود الحساب مستخدم بالفعل');
    }
  }

  private assertFlagsNotConflicting(isHeader?: boolean, allowPosting?: boolean): void {
    if (isHeader && allowPosting) {
      throw new BadRequestException(
        'لا يمكن أن يكون الحساب رئيسياً وقابلاً للترحيل في نفس الوقت',
      );
    }
  }

  /** Prevent moving an account under one of its own descendants. */
  private async assertNotDescendant(
    repo: Repository<ChartOfAccount>,
    accountId: string,
    newParentId: string,
  ): Promise<void> {
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === accountId) {
        throw new BadRequestException('لا يمكن نقل الحساب إلى أحد حساباته الفرعية');
      }
      const parent: ChartOfAccount | null = await repo.findOne({
        where: { id: cursor },
        select: { id: true, parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  /** Cascade the new level down the subtree after a re-parent. */
  private async recomputeDescendantLevels(
    repo: Repository<ChartOfAccount>,
    parentId: string,
    parentLevel: number,
  ): Promise<void> {
    const children = await repo.find({ where: { parentId } });
    for (const child of children) {
      child.level = parentLevel + 1;
      await repo.save(child);
      await this.recomputeDescendantLevels(repo, child.id, child.level);
    }
  }

  /**
   * Placeholder hook — always false until journal entries / accounting settings
   * / ERP transactions exist. Wire those repositories here later.
   */
  private async isAccountUsed(_accountId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
