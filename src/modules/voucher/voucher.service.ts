import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Voucher } from './entities/voucher.entity';
import {
  VoucherPaymentMethod,
  VoucherStatus,
  VoucherType,
} from './enums/voucher.enum';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { Branch } from '../branch/entities/branch.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { User } from '../user/entities/user.entity';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface VoucherListItem {
  id: string;
  voucherNumber: string | null;
  type: VoucherType;
  voucherDate: string;
  partyId: string;
  partyName: string | null;
  paymentMethod: VoucherPaymentMethod;
  accountName: string | null;
  amount: number;
  status: VoucherStatus;
}

@Injectable()
export class VoucherService {
  constructor(
    @InjectRepository(Voucher)
    private readonly voucherRepository: Repository<Voucher>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    @InjectRepository(Treasury)
    private readonly treasuryRepository: Repository<Treasury>,
    @InjectRepository(BankAccount)
    private readonly bankRepository: Repository<BankAccount>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepository: Repository<AccountingPeriod>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // =========================================================
  // CREATE / UPDATE / DELETE (DRAFT only)
  // =========================================================
  async create(
    dto: CreateVoucherDto,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<Voucher> {
    const partyName = await this.assertParty(dto.type, dto.partyId);
    await this.assertMethod(dto.paymentMethod, dto.treasuryId ?? null, dto.bankAccountId ?? null);
    await this.assertPeriod(dto.fiscalYearId, dto.accountingPeriodId);

    const voucher = this.voucherRepository.create({
      voucherNumber: null,
      type: dto.type,
      voucherDate: dto.voucherDate,
      partyId: dto.partyId,
      partyName,
      paymentMethod: dto.paymentMethod,
      treasuryId: dto.paymentMethod === VoucherPaymentMethod.TREASURY ? dto.treasuryId ?? null : null,
      bankAccountId: dto.paymentMethod === VoucherPaymentMethod.BANK ? dto.bankAccountId ?? null : null,
      amount: dto.amount,
      fiscalYearId: dto.fiscalYearId,
      accountingPeriodId: dto.accountingPeriodId,
      // A branch-restricted user's documents are forced onto their own branch.
      branchId: branchScope ?? dto.branchId ?? null,
      reference: dto.reference ?? null,
      notes: dto.notes ?? null,
      status: VoucherStatus.DRAFT,
      createdBy: actorId ?? null,
    });
    return this.voucherRepository.save(voucher);
  }

  async update(
    id: string,
    dto: UpdateVoucherDto,
    actorId?: string,
    branchScope: string | null = null,
  ): Promise<Voucher> {
    const voucher = await this.getEditableDraft(id, branchScope);

    if (dto.partyId) voucher.partyName = await this.assertParty(voucher.type, dto.partyId);
    if (dto.partyId) voucher.partyId = dto.partyId;
    if (dto.voucherDate) voucher.voucherDate = dto.voucherDate;
    if (dto.amount !== undefined) voucher.amount = dto.amount;
    if (dto.fiscalYearId) voucher.fiscalYearId = dto.fiscalYearId;
    if (dto.accountingPeriodId) voucher.accountingPeriodId = dto.accountingPeriodId;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope) voucher.branchId = branchScope;
    else if (dto.branchId !== undefined) voucher.branchId = dto.branchId ?? null;
    if (dto.reference !== undefined) voucher.reference = dto.reference ?? null;
    if (dto.notes !== undefined) voucher.notes = dto.notes ?? null;

    if (dto.paymentMethod) {
      voucher.paymentMethod = dto.paymentMethod;
      voucher.treasuryId = dto.paymentMethod === VoucherPaymentMethod.TREASURY ? dto.treasuryId ?? null : null;
      voucher.bankAccountId = dto.paymentMethod === VoucherPaymentMethod.BANK ? dto.bankAccountId ?? null : null;
    } else {
      if (dto.treasuryId !== undefined && voucher.paymentMethod === VoucherPaymentMethod.TREASURY) {
        voucher.treasuryId = dto.treasuryId ?? null;
      }
      if (dto.bankAccountId !== undefined && voucher.paymentMethod === VoucherPaymentMethod.BANK) {
        voucher.bankAccountId = dto.bankAccountId ?? null;
      }
    }
    await this.assertMethod(voucher.paymentMethod, voucher.treasuryId, voucher.bankAccountId);
    await this.assertPeriod(voucher.fiscalYearId, voucher.accountingPeriodId);

    voucher.updatedBy = actorId ?? null;
    return this.voucherRepository.save(voucher);
  }

  async remove(id: string, actorId?: string, branchScope: string | null = null): Promise<void> {
    await this.getEditableDraft(id, branchScope);
    await this.voucherRepository.update(id, { deletedBy: actorId ?? null });
    await this.voucherRepository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: VoucherQueryDto,
    branchScope: string | null = null,
  ): Promise<PaginatedResult<VoucherListItem>> {
    const qb = this.voucherRepository.createQueryBuilder('v');
    // Branch-restricted users only ever see their own branch's documents.
    if (branchScope) qb.andWhere('v.branchId = :branchScope', { branchScope });
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('v.voucherNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('v.partyName LIKE :s', { s: `%${query.search}%` })
            .orWhere('v.reference LIKE :s', { s: `%${query.search}%` });
        }),
      );
    }
    if (query.type) qb.andWhere('v.type = :t', { t: query.type });
    if (query.partyId) qb.andWhere('v.partyId = :pid', { pid: query.partyId });
    if (query.paymentMethod) qb.andWhere('v.paymentMethod = :pm', { pm: query.paymentMethod });
    if (query.status) qb.andWhere('v.status = :st', { st: query.status });
    if (query.fiscalYearId) qb.andWhere('v.fiscalYearId = :fy', { fy: query.fiscalYearId });
    if (query.branchId) qb.andWhere('v.branchId = :br', { br: query.branchId });
    if (query.dateFrom) qb.andWhere('v.voucherDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('v.voucherDate <= :dt', { dt: query.dateTo });

    qb.orderBy('v.voucherDate', 'DESC').addOrderBy('v.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const accountNames = await this.methodNames(items);
    const rows: VoucherListItem[] = items.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      type: v.type,
      voucherDate: v.voucherDate,
      partyId: v.partyId,
      partyName: v.partyName,
      paymentMethod: v.paymentMethod,
      accountName: accountNames.get(v.id) ?? null,
      amount: v.amount,
      status: v.status,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: string | null = null): Promise<Voucher> {
    const voucher = await this.voucherRepository.findOne({ where: { id } });
    if (!voucher || (branchScope && voucher.branchId !== branchScope)) {
      throw new NotFoundException('لم يتم العثور على السند');
    }
    return voucher;
  }

  async findOneDetailed(id: string, branchScope: string | null = null): Promise<Record<string, unknown>> {
    const v = await this.findOne(id, branchScope);
    const [treasury, bank, branch, fiscalYear, period, users] = await Promise.all([
      v.treasuryId ? this.treasuryRepository.findOne({ where: { id: v.treasuryId } }) : null,
      v.bankAccountId ? this.bankRepository.findOne({ where: { id: v.bankAccountId } }) : null,
      v.branchId ? this.branchRepository.findOne({ where: { id: v.branchId } }) : null,
      this.fiscalYearRepository.findOne({ where: { id: v.fiscalYearId } }),
      this.periodRepository.findOne({ where: { id: v.accountingPeriodId } }),
      this.userNames([v.createdBy, v.postedBy, v.reversedBy]),
    ]);
    return {
      ...v,
      accountName: treasury?.name ?? (bank ? `${bank.bankName} - ${bank.accountName}` : null),
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      accountingPeriodName: period?.name ?? null,
      createdByName: users.get(v.createdBy ?? '') ?? null,
      postedByName: users.get(v.postedBy ?? '') ?? null,
      reversedByName: users.get(v.reversedBy ?? '') ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async getEditableDraft(id: string, branchScope: string | null = null): Promise<Voucher> {
    const voucher = await this.findOne(id, branchScope);
    if (voucher.status !== VoucherStatus.DRAFT) {
      throw new BadRequestException('لا يمكن تعديل أو حذف سند مُرحّل — استخدم العكس');
    }
    return voucher;
  }

  /** Validate the party exists for the voucher type; return its name. */
  private async assertParty(type: VoucherType, partyId: string): Promise<string> {
    if (type === VoucherType.RECEIPT) {
      const c = await this.customerRepository.findOne({ where: { id: partyId } });
      if (!c) throw new NotFoundException('العميل غير موجود');
      return c.name;
    }
    const s = await this.supplierRepository.findOne({ where: { id: partyId } });
    if (!s) throw new NotFoundException('المورّد غير موجود');
    return s.name;
  }

  private async assertMethod(
    method: VoucherPaymentMethod,
    treasuryId: string | null,
    bankAccountId: string | null,
  ): Promise<void> {
    if (method === VoucherPaymentMethod.TREASURY) {
      if (!treasuryId) throw new BadRequestException('يجب اختيار الخزينة');
      const t = await this.treasuryRepository.findOne({ where: { id: treasuryId } });
      if (!t) throw new NotFoundException('الخزينة غير موجودة');
    } else {
      if (!bankAccountId) throw new BadRequestException('يجب اختيار الحساب البنكي');
      const b = await this.bankRepository.findOne({ where: { id: bankAccountId } });
      if (!b) throw new NotFoundException('الحساب البنكي غير موجود');
    }
  }

  private async assertPeriod(fiscalYearId: string, periodId: string): Promise<void> {
    const period = await this.periodRepository.findOne({ where: { id: periodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYearId) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
  }

  private async methodNames(items: Voucher[]): Promise<Map<string, string>> {
    const treasuryIds = items.map((v) => v.treasuryId).filter((x): x is string => !!x);
    const bankIds = items.map((v) => v.bankAccountId).filter((x): x is string => !!x);
    const [treasuries, banks] = await Promise.all([
      treasuryIds.length ? this.treasuryRepository.find({ where: { id: In(treasuryIds) } }) : [],
      bankIds.length ? this.bankRepository.find({ where: { id: In(bankIds) } }) : [],
    ]);
    const tById = new Map(treasuries.map((t): [string, string] => [t.id, t.name]));
    const bById = new Map(banks.map((b): [string, string] => [b.id, `${b.bankName} - ${b.accountName}`]));
    const result = new Map<string, string>();
    for (const v of items) {
      if (v.treasuryId) result.set(v.id, tById.get(v.treasuryId) ?? '');
      else if (v.bankAccountId) result.set(v.id, bById.get(v.bankAccountId) ?? '');
    }
    return result;
  }

  private async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await this.userRepository.find({ where: { id: In(unique) } });
    return new Map(users.map((u): [string, string] => [u.id, u.fullName]));
  }
}
