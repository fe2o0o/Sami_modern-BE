import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BankAccount } from './entities/bank-account.entity';
import { BankTransaction } from './entities/bank-transaction.entity';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';
import { assertOperationalAccount } from '../treasury/operational-account.rule';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Branch } from '../branch/entities/branch.entity';
import { AccountSubType, AccountType } from '../chart-of-account/enums/account.enum';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';
import { CodeSettingService } from '../code-setting/code-setting.service';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'BNK-002', note: 'كود فريد للحساب البنكي' },
  { field: 'bankName', header: 'اسم البنك', required: true, example: 'البنك الأهلي' },
  { field: 'accountName', header: 'اسم الحساب', required: true, example: 'سامي للأثاث' },
  { field: 'accountNumber', header: 'رقم الحساب', example: '1234567890' },
  { field: 'iban', header: 'الآيبان', example: 'EG380000000000000001234567890' },
  { field: 'branchCodes', header: 'أكواد الفروع', example: 'BR-001,BR-002', note: 'أكواد فروع مفصولة بفاصلة. اتركها فارغة ليكون متاحًا لكل الفروع' },
  { field: 'accountCode', header: 'كود الحساب البنكي (GL)', required: true, example: '111300', note: 'حساب أصول/بنك قابل للترحيل' },
  { field: 'currencyCode', header: 'العملة', example: 'EGP', note: 'افتراضي: EGP' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'notes', header: 'ملاحظات', example: '' },
];

export interface BankAccountView extends BankAccount {
  accountCode: string | null;
  glAccountName: string | null;
  /** Empty = available to all branches. */
  branchIds: string[];
  branchNames: string[];
}

export interface BankAccountLookupItem {
  id: string;
  code: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string | null;
  /** Empty = available to all branches. */
  branchIds: string[];
  accountId: string;
  accountCode: string | null;
  glAccountName: string | null;
  currencyCode: string;
}

@Injectable()
export class BankAccountService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly bankRepository: Repository<BankAccount>,
    @InjectRepository(BankTransaction)
    private readonly transactionRepository: Repository<BankTransaction>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    imports: ImportRegistry,
  ) {
    imports.register('bank-accounts', {
      templateFilename: 'bank-accounts-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'الحسابات البنكية',
      title: 'استيراد الحسابات البنكية',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.bankRepository.manager.connection, parsed, async (v, manager) => {
      const repo = manager.getRepository(BankAccount);
      const code = await this.codeSettings.resolveCode('bank_account', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الحساب البنكي «${code}» مستخدم بالفعل`);
      }

      // Optional comma-separated branch codes. Empty = available to all branches.
      const branchCodesRaw = optStr(v.branchCodes) ?? '';
      const branchCodes = branchCodesRaw
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const branches: Branch[] = [];
      for (const branchCode of branchCodes) {
        const branch = await manager.getRepository(Branch).findOne({ where: { code: branchCode } });
        if (!branch) throw new Error(`الفرع بكود «${branchCode}» غير موجود`);
        branches.push(branch);
      }

      const accountCode = str(v.accountCode, 'كود الحساب البنكي (GL)');
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
          allowedSubTypes: [AccountSubType.BANK],
          label: 'الحساب البنكي',
          kind: 'حساب بنك',
        },
      );

      await repo.save(
        repo.create({
          code,
          bankName: str(v.bankName, 'اسم البنك'),
          accountName: str(v.accountName, 'اسم الحساب'),
          accountNumber: optStr(v.accountNumber),
          iban: optStr(v.iban),
          branches,
          accountId: account.id,
          currencyCode: optStr(v.currencyCode) ?? 'EGP',
          isActive: bool(v.isActive, true),
          notes: optStr(v.notes),
        }),
      );
    });
  }

  async create(dto: CreateBankAccountDto, actorId?: string): Promise<BankAccount> {
    const code = await this.codeSettings.resolveCode('bank_account', dto.code);
    await this.ensureCodeUnique(code);
    const branches = await this.resolveBranches(dto.branchIds);
    await this.assertAccount(dto.accountId);

    return this.bankRepository.save(
      this.bankRepository.create({
        code,
        bankName: dto.bankName,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber ?? null,
        iban: dto.iban ?? null,
        branches,
        accountId: dto.accountId,
        currencyCode: dto.currencyCode ?? 'EGP',
        isActive: dto.isActive ?? true,
        notes: dto.notes ?? null,
        createdBy: actorId ?? null,
      }),
    );
  }

  async findAll(query: QueryBankAccountDto): Promise<PaginatedResult<BankAccountView>> {
    const qb = this.bankRepository.createQueryBuilder('b');
    if (query.search) {
      qb.andWhere('(b.code LIKE :s OR b.bankName LIKE :s OR b.accountName LIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    // A branch matches an account assigned to it OR an account with no branches
    // (a shared/all-branches account).
    if (query.branchId) qb.andWhere(this.branchVisibilityClause('b'), { br: query.branchId });
    if (query.isActive !== undefined) qb.andWhere('b.isActive = :a', { a: query.isActive });

    qb.orderBy('b.code', query.order).skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    const views = await this.enrich(items);
    return paginate(views, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<BankAccountView> {
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) throw new NotFoundException('لم يتم العثور على الحساب البنكي');
    return (await this.enrich([bank]))[0];
  }

  async update(
    id: string,
    dto: UpdateBankAccountDto,
    actorId?: string,
  ): Promise<BankAccount> {
    const bank = await this.bankRepository.findOne({
      where: { id },
      relations: { branches: true },
    });
    if (!bank) throw new NotFoundException('لم يتم العثور على الحساب البنكي');

    if (dto.code && dto.code !== bank.code) await this.ensureCodeUnique(dto.code, id);
    if (dto.accountId) await this.assertAccount(dto.accountId);
    if (dto.branchIds !== undefined) bank.branches = await this.resolveBranches(dto.branchIds);

    Object.assign(bank, {
      code: dto.code ?? bank.code,
      bankName: dto.bankName ?? bank.bankName,
      accountName: dto.accountName ?? bank.accountName,
      accountNumber: dto.accountNumber !== undefined ? dto.accountNumber : bank.accountNumber,
      iban: dto.iban !== undefined ? dto.iban : bank.iban,
      accountId: dto.accountId ?? bank.accountId,
      currencyCode: dto.currencyCode ?? bank.currencyCode,
      isActive: dto.isActive ?? bank.isActive,
      notes: dto.notes !== undefined ? dto.notes : bank.notes,
      updatedBy: actorId ?? null,
    });
    // Saving the owning side syncs the bank_account_branches join rows.
    return this.bankRepository.save(bank);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) throw new NotFoundException('لم يتم العثور على الحساب البنكي');

    const txCount = await this.transactionRepository.count({ where: { bankAccountId: id } });
    if (txCount > 0) {
      throw new BadRequestException('لا يمكن حذف الحساب البنكي لوجود حركات مسجلة عليه');
    }
    await this.bankRepository.update(id, { deletedBy: actorId ?? null });
    await this.bankRepository.softDelete(id);
  }

  async lookup(branchId?: string): Promise<BankAccountLookupItem[]> {
    const qb = this.bankRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.branches', 'br')
      .where('b.isActive = :a', { a: true });
    if (branchId) qb.andWhere(this.branchVisibilityClause('b'), { br: branchId });
    qb.orderBy('b.code', 'ASC');

    const banks = await qb.getMany();
    const accounts = await this.accountMap(banks.map((b) => b.accountId));
    return banks.map((b) => ({
      id: b.id,
      code: b.code,
      bankName: b.bankName,
      accountName: b.accountName,
      accountNumberMasked: this.mask(b.accountNumber),
      branchIds: (b.branches ?? []).map((x) => x.id),
      accountId: b.accountId,
      accountCode: accounts.get(b.accountId)?.code ?? null,
      glAccountName: accounts.get(b.accountId)?.name ?? null,
      currencyCode: b.currencyCode,
    }));
  }

  // =========================================================
  // HELPERS
  // =========================================================
  /**
   * SQL predicate: the account is visible to :br when it is explicitly linked to
   * that branch, OR it has no branch links at all (shared / all-branches).
   */
  private branchVisibilityClause(alias: string): string {
    return `(
      EXISTS (SELECT 1 FROM bank_account_branches bab
              WHERE bab.bank_account_id = ${alias}.id AND bab.branch_id = :br)
      OR NOT EXISTS (SELECT 1 FROM bank_account_branches babx
                     WHERE babx.bank_account_id = ${alias}.id)
    )`;
  }

  private async enrich(items: BankAccount[]): Promise<BankAccountView[]> {
    const accounts = await this.accountMap(items.map((b) => b.accountId));
    const branchesByAccount = await this.branchesFor(items.map((b) => b.id));
    return items.map((b) => {
      const info = accounts.get(b.accountId);
      const branches = branchesByAccount.get(b.id) ?? [];
      return Object.assign(b, {
        accountCode: info?.code ?? null,
        glAccountName: info?.name ?? null,
        branches,
        branchIds: branches.map((x) => x.id),
        branchNames: branches.map((x) => x.name),
      }) as BankAccountView;
    });
  }

  /** Load the branch links for a set of accounts in one query. */
  private async branchesFor(ids: string[]): Promise<Map<string, Branch[]>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.bankRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.branches', 'br')
      .where('b.id IN (:...ids)', { ids: unique })
      .getMany();
    return new Map(rows.map((r): [string, Branch[]] => [r.id, r.branches ?? []]));
  }

  private mask(accountNumber: string | null): string | null {
    if (!accountNumber) return null;
    const tail = accountNumber.slice(-4);
    return `****${tail}`;
  }

  private async accountMap(
    ids: string[],
  ): Promise<Map<string, { code: string; name: string }>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.accountRepository.find({ where: { id: In(unique) } });
    return new Map(
      rows.map((a): [string, { code: string; name: string }] => [
        a.id,
        { code: a.accountCode, name: `${a.accountCode} - ${a.accountNameAr}` },
      ]),
    );
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.bankRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود الحساب البنكي مستخدم بالفعل');
    }
  }

  /** Resolve+validate the branch ids. Empty/undefined → no branches (all). */
  private async resolveBranches(ids?: string[]): Promise<Branch[]> {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (!unique.length) return [];
    const rows = await this.branchRepository.find({ where: { id: In(unique) } });
    if (rows.length !== unique.length) {
      throw new NotFoundException('أحد الفروع المختارة غير موجود');
    }
    return rows;
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
        allowedSubTypes: [AccountSubType.BANK],
        label: 'الحساب البنكي',
        kind: 'حساب بنك',
      },
    );
  }
}
