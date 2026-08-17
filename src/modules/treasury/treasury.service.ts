import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
import { Treasury } from './entities/treasury.entity';
import { TreasuryTransaction } from './entities/treasury-transaction.entity';
import { CreateTreasuryDto } from './dto/create-treasury.dto';
import { UpdateTreasuryDto } from './dto/update-treasury.dto';
import { QueryTreasuryDto } from './dto/query-treasury.dto';
import { assertOperationalAccount } from './operational-account.rule';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Branch } from '../branch/entities/branch.entity';
import { AccountSubType, AccountType } from '../chart-of-account/enums/account.enum';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', required: true, example: 'TR-002', note: 'كود فريد للخزينة' },
  { field: 'name', header: 'الاسم', required: true, example: 'خزينة فرع الإسكندرية' },
  { field: 'branchCode', header: 'كود الفرع', required: true, example: 'BR-001', note: 'كود فرع موجود' },
  { field: 'accountCode', header: 'كود حساب النقدية', required: true, example: '1111001', note: 'حساب أصول/نقدية قابل للترحيل' },
  { field: 'isDefault', header: 'افتراضي للفرع', type: 'boolean', example: 'لا', note: 'نعم/لا' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'notes', header: 'ملاحظات', example: '' },
];

export interface TreasuryView extends Treasury {
  accountCode: string | null;
  accountName: string | null;
  branchName: string | null;
}

export interface TreasuryLookupItem {
  id: string;
  code: string;
  name: string;
  branchId: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  isDefault: boolean;
}

@Injectable()
export class TreasuryService {
  constructor(
    @InjectRepository(Treasury)
    private readonly treasuryRepository: Repository<Treasury>,
    @InjectRepository(TreasuryTransaction)
    private readonly transactionRepository: Repository<TreasuryTransaction>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly excel: ExcelService,
    imports: ImportRegistry,
  ) {
    imports.register('treasuries', {
      templateFilename: 'treasuries-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'الخزائن',
      title: 'استيراد الخزائن',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.treasuryRepository.manager.connection, parsed, async (v, manager) => {
      const repo = manager.getRepository(Treasury);
      const code = str(v.code, 'الكود');
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الخزينة «${code}» مستخدم بالفعل`);
      }

      const branchCode = str(v.branchCode, 'كود الفرع');
      const branch = await manager.getRepository(Branch).findOne({ where: { code: branchCode } });
      if (!branch) throw new Error(`الفرع بكود «${branchCode}» غير موجود`);

      const accountCode = str(v.accountCode, 'كود حساب النقدية');
      const account = await manager
        .getRepository(ChartOfAccount)
        .findOne({ where: { accountCode } });
      if (!account) throw new Error(`الحساب بكود «${accountCode}» غير موجود`);
      assertOperationalAccount(
        {
          isActive: account.isActive,
          allowPosting: account.allowPosting,
          isHeader: account.isHeader,
          accountType: account.accountType,
          accountSubType: account.accountSubType,
          name: account.accountNameAr,
        },
        {
          allowedType: AccountType.ASSET,
          allowedSubTypes: [AccountSubType.CASH],
          label: 'الخزينة',
          kind: 'حساب نقدية',
        },
      );

      const isDefault = bool(v.isDefault, false);
      if (isDefault) {
        await manager.update(Treasury, { branchId: branch.id, isDefault: true }, { isDefault: false });
      }

      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          branchId: branch.id,
          accountId: account.id,
          isDefault,
          isActive: bool(v.isActive, true),
          notes: optStr(v.notes),
        }),
      );
    });
  }

  async create(dto: CreateTreasuryDto, actorId?: string): Promise<Treasury> {
    await this.ensureCodeUnique(dto.code);
    await this.assertBranch(dto.branchId);
    await this.assertAccount(dto.accountId);

    return this.treasuryRepository.manager.transaction(async (manager) => {
      if (dto.isDefault) {
        await this.clearDefault(manager, dto.branchId);
      }
      const repo = manager.getRepository(Treasury);
      return repo.save(
        repo.create({
          code: dto.code,
          name: dto.name,
          branchId: dto.branchId,
          accountId: dto.accountId,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          notes: dto.notes ?? null,
          createdBy: actorId ?? null,
        }),
      );
    });
  }

  async findAll(query: QueryTreasuryDto): Promise<PaginatedResult<TreasuryView>> {
    const qb = this.treasuryRepository.createQueryBuilder('t');
    if (query.search) {
      qb.andWhere('(t.code LIKE :s OR t.name LIKE :s)', { s: `%${query.search}%` });
    }
    if (query.branchId) qb.andWhere('t.branchId = :br', { br: query.branchId });
    if (query.isActive !== undefined) qb.andWhere('t.isActive = :a', { a: query.isActive });

    qb.orderBy('t.code', query.order).skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    const views = await this.enrich(items);
    return paginate(views, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<TreasuryView> {
    const treasury = await this.treasuryRepository.findOne({ where: { id } });
    if (!treasury) throw new NotFoundException('لم يتم العثور على الخزينة');
    return (await this.enrich([treasury]))[0];
  }

  async update(
    id: string,
    dto: UpdateTreasuryDto,
    actorId?: string,
  ): Promise<Treasury> {
    const treasury = await this.treasuryRepository.findOne({ where: { id } });
    if (!treasury) throw new NotFoundException('لم يتم العثور على الخزينة');

    if (dto.code && dto.code !== treasury.code) await this.ensureCodeUnique(dto.code, id);
    if (dto.branchId) await this.assertBranch(dto.branchId);
    if (dto.accountId) await this.assertAccount(dto.accountId);

    const targetBranch = dto.branchId ?? treasury.branchId;

    return this.treasuryRepository.manager.transaction(async (manager) => {
      if (dto.isDefault && !(treasury.isDefault && targetBranch === treasury.branchId)) {
        await this.clearDefault(manager, targetBranch, id);
      }
      Object.assign(treasury, {
        code: dto.code ?? treasury.code,
        name: dto.name ?? treasury.name,
        branchId: targetBranch,
        accountId: dto.accountId ?? treasury.accountId,
        isDefault: dto.isDefault ?? treasury.isDefault,
        isActive: dto.isActive ?? treasury.isActive,
        notes: dto.notes !== undefined ? dto.notes : treasury.notes,
        updatedBy: actorId ?? null,
      });
      return manager.getRepository(Treasury).save(treasury);
    });
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const treasury = await this.treasuryRepository.findOne({ where: { id } });
    if (!treasury) throw new NotFoundException('لم يتم العثور على الخزينة');

    const txCount = await this.transactionRepository.count({ where: { treasuryId: id } });
    if (txCount > 0) {
      throw new BadRequestException('لا يمكن حذف الخزينة لوجود حركات مسجلة عليها');
    }
    await this.treasuryRepository.update(id, { deletedBy: actorId ?? null });
    await this.treasuryRepository.softDelete(id);
  }

  async lookup(branchId?: string): Promise<TreasuryLookupItem[]> {
    const treasuries = await this.treasuryRepository.find({
      where: { isActive: true, ...(branchId ? { branchId } : {}) },
      order: { code: 'ASC' },
    });
    const accounts = await this.accountMap(treasuries.map((t) => t.accountId));
    return treasuries.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      branchId: t.branchId,
      accountId: t.accountId,
      accountCode: accounts.get(t.accountId)?.code ?? null,
      accountName: accounts.get(t.accountId)?.name ?? null,
      isDefault: t.isDefault,
    }));
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async enrich(items: Treasury[]): Promise<TreasuryView[]> {
    const accounts = await this.accountMap(items.map((t) => t.accountId));
    const branches = await this.branchMap(items.map((t) => t.branchId));
    return items.map((t) => {
      const info = accounts.get(t.accountId);
      return Object.assign(t, {
        accountCode: info?.code ?? null,
        accountName: info ? `${info.code} - ${info.rawName}` : null,
        branchName: branches.get(t.branchId) ?? null,
      }) as TreasuryView;
    });
  }

  private async accountMap(
    ids: string[],
  ): Promise<Map<string, { code: string; name: string; rawName: string }>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.accountRepository.find({ where: { id: In(unique) } });
    return new Map(
      rows.map((a): [string, { code: string; name: string; rawName: string }] => [
        a.id,
        { code: a.accountCode, name: `${a.accountCode} - ${a.accountNameAr}`, rawName: a.accountNameAr },
      ]),
    );
  }

  private async branchMap(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.branchRepository.find({ where: { id: In(unique) } });
    return new Map(rows.map((b): [string, string] => [b.id, b.name]));
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.treasuryRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود الخزينة مستخدم بالفعل');
    }
  }

  private async assertBranch(branchId: string): Promise<void> {
    const branch = await this.branchRepository.findOne({ where: { id: branchId } });
    if (!branch) throw new NotFoundException('الفرع غير موجود');
  }

  private async assertAccount(accountId: string): Promise<void> {
    const account = await this.accountRepository.findOne({ where: { id: accountId } });
    assertOperationalAccount(
      account
        ? {
            isActive: account.isActive,
            allowPosting: account.allowPosting,
            isHeader: account.isHeader,
            accountType: account.accountType,
            accountSubType: account.accountSubType,
            name: account.accountNameAr,
          }
        : null,
      {
        allowedType: AccountType.ASSET,
        allowedSubTypes: [AccountSubType.CASH],
        label: 'الخزينة',
        kind: 'حساب نقدية',
      },
    );
  }

  /** Unset the default flag on any other treasury of the branch. */
  private async clearDefault(
    manager: EntityManager,
    branchId: string,
    exceptId?: string,
  ): Promise<void> {
    await manager.update(
      Treasury,
      { branchId, isDefault: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      { isDefault: false },
    );
  }
}
