import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, Repository } from 'typeorm';
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
  { field: 'code', header: 'الكود', required: true, example: 'BNK-002', note: 'كود فريد للحساب البنكي' },
  { field: 'bankName', header: 'اسم البنك', required: true, example: 'البنك الأهلي' },
  { field: 'accountName', header: 'اسم الحساب', required: true, example: 'سامي للأثاث' },
  { field: 'accountNumber', header: 'رقم الحساب', example: '1234567890' },
  { field: 'iban', header: 'الآيبان', example: 'EG380000000000000001234567890' },
  { field: 'branchCode', header: 'كود الفرع', required: true, example: 'BR-001', note: 'كود فرع موجود' },
  { field: 'accountCode', header: 'كود الحساب البنكي (GL)', required: true, example: '111300', note: 'حساب أصول/بنك قابل للترحيل' },
  { field: 'currencyCode', header: 'العملة', example: 'EGP', note: 'افتراضي: EGP' },
  { field: 'isDefault', header: 'افتراضي للفرع', type: 'boolean', example: 'لا', note: 'نعم/لا' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'notes', header: 'ملاحظات', example: '' },
];

export interface BankAccountView extends BankAccount {
  accountCode: string | null;
  glAccountName: string | null;
  branchName: string | null;
}

export interface BankAccountLookupItem {
  id: string;
  code: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string | null;
  branchId: string;
  accountId: string;
  accountCode: string | null;
  glAccountName: string | null;
  currencyCode: string;
  isDefault: boolean;
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
      const code = str(v.code, 'الكود');
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الحساب البنكي «${code}» مستخدم بالفعل`);
      }

      const branchCode = str(v.branchCode, 'كود الفرع');
      const branch = await manager.getRepository(Branch).findOne({ where: { code: branchCode } });
      if (!branch) throw new Error(`الفرع بكود «${branchCode}» غير موجود`);

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

      const isDefault = bool(v.isDefault, false);
      if (isDefault) {
        await manager.update(BankAccount, { branchId: branch.id, isDefault: true }, { isDefault: false });
      }

      await repo.save(
        repo.create({
          code,
          bankName: str(v.bankName, 'اسم البنك'),
          accountName: str(v.accountName, 'اسم الحساب'),
          accountNumber: optStr(v.accountNumber),
          iban: optStr(v.iban),
          branchId: branch.id,
          accountId: account.id,
          currencyCode: optStr(v.currencyCode) ?? 'EGP',
          isDefault,
          isActive: bool(v.isActive, true),
          notes: optStr(v.notes),
        }),
      );
    });
  }

  async create(dto: CreateBankAccountDto, actorId?: string): Promise<BankAccount> {
    const code = await this.codeSettings.resolveCode('bank_account', dto.code);
    await this.ensureCodeUnique(code);
    await this.assertBranch(dto.branchId);
    await this.assertAccount(dto.accountId);

    return this.bankRepository.manager.transaction(async (manager) => {
      if (dto.isDefault) {
        await this.clearDefault(manager, dto.branchId);
      }
      const repo = manager.getRepository(BankAccount);
      return repo.save(
        repo.create({
          code,
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber ?? null,
          iban: dto.iban ?? null,
          branchId: dto.branchId,
          accountId: dto.accountId,
          currencyCode: dto.currencyCode ?? 'EGP',
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          notes: dto.notes ?? null,
          createdBy: actorId ?? null,
        }),
      );
    });
  }

  async findAll(query: QueryBankAccountDto): Promise<PaginatedResult<BankAccountView>> {
    const qb = this.bankRepository.createQueryBuilder('b');
    if (query.search) {
      qb.andWhere('(b.code LIKE :s OR b.bankName LIKE :s OR b.accountName LIKE :s)', {
        s: `%${query.search}%`,
      });
    }
    if (query.branchId) qb.andWhere('b.branchId = :br', { br: query.branchId });
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
    const bank = await this.bankRepository.findOne({ where: { id } });
    if (!bank) throw new NotFoundException('لم يتم العثور على الحساب البنكي');

    if (dto.code && dto.code !== bank.code) await this.ensureCodeUnique(dto.code, id);
    if (dto.branchId) await this.assertBranch(dto.branchId);
    if (dto.accountId) await this.assertAccount(dto.accountId);

    const targetBranch = dto.branchId ?? bank.branchId;

    return this.bankRepository.manager.transaction(async (manager) => {
      if (dto.isDefault && !(bank.isDefault && targetBranch === bank.branchId)) {
        await this.clearDefault(manager, targetBranch, id);
      }
      Object.assign(bank, {
        code: dto.code ?? bank.code,
        bankName: dto.bankName ?? bank.bankName,
        accountName: dto.accountName ?? bank.accountName,
        accountNumber: dto.accountNumber !== undefined ? dto.accountNumber : bank.accountNumber,
        iban: dto.iban !== undefined ? dto.iban : bank.iban,
        branchId: targetBranch,
        accountId: dto.accountId ?? bank.accountId,
        currencyCode: dto.currencyCode ?? bank.currencyCode,
        isDefault: dto.isDefault ?? bank.isDefault,
        isActive: dto.isActive ?? bank.isActive,
        notes: dto.notes !== undefined ? dto.notes : bank.notes,
        updatedBy: actorId ?? null,
      });
      return manager.getRepository(BankAccount).save(bank);
    });
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
    const banks = await this.bankRepository.find({
      where: { isActive: true, ...(branchId ? { branchId } : {}) },
      order: { code: 'ASC' },
    });
    const accounts = await this.accountMap(banks.map((b) => b.accountId));
    return banks.map((b) => ({
      id: b.id,
      code: b.code,
      bankName: b.bankName,
      accountName: b.accountName,
      accountNumberMasked: this.mask(b.accountNumber),
      branchId: b.branchId,
      accountId: b.accountId,
      accountCode: accounts.get(b.accountId)?.code ?? null,
      glAccountName: accounts.get(b.accountId)?.name ?? null,
      currencyCode: b.currencyCode,
      isDefault: b.isDefault,
    }));
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async enrich(items: BankAccount[]): Promise<BankAccountView[]> {
    const accounts = await this.accountMap(items.map((b) => b.accountId));
    const branches = await this.branchMap(items.map((b) => b.branchId));
    return items.map((b) => {
      const info = accounts.get(b.accountId);
      return Object.assign(b, {
        accountCode: info?.code ?? null,
        glAccountName: info?.name ?? null,
        branchName: branches.get(b.branchId) ?? null,
      }) as BankAccountView;
    });
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

  private async branchMap(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await this.branchRepository.find({ where: { id: In(unique) } });
    return new Map(rows.map((b): [string, string] => [b.id, b.name]));
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.bankRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود الحساب البنكي مستخدم بالفعل');
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
        allowedSubTypes: [AccountSubType.BANK],
        label: 'الحساب البنكي',
        kind: 'حساب بنك',
      },
    );
  }

  private async clearDefault(
    manager: EntityManager,
    branchId: string,
    exceptId?: string,
  ): Promise<void> {
    await manager.update(
      BankAccount,
      { branchId, isDefault: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      { isDefault: false },
    );
  }
}
