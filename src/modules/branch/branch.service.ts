import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Branch } from './entities/branch.entity';
import { Company } from '../company/entities/company.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { WarehouseType } from '../warehouse/enums/warehouse-type.enum';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';
import { StockMovement } from '../stock/entities/stock-movement.entity';
import { SalesInvoice } from '../sales-invoice/entities/sales-invoice.entity';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { QueryBranchDto } from './dto/query-branch.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', required: true, example: 'BR-002', note: 'كود فريد للفرع' },
  { field: 'name', header: 'الاسم', required: true, example: 'فرع الإسكندرية' },
  { field: 'managerName', header: 'اسم المدير', example: 'أحمد علي' },
  { field: 'phone', header: 'الهاتف', example: '0221000000' },
  { field: 'mobile', header: 'الجوال', example: '01000000000' },
  { field: 'email', header: 'البريد الإلكتروني', example: 'branch@sami.com' },
  { field: 'country', header: 'الدولة', example: 'مصر' },
  { field: 'city', header: 'المدينة', example: 'الإسكندرية' },
  { field: 'address', header: 'العنوان', example: 'شارع فؤاد' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'notes', header: 'ملاحظات', example: '' },
];

@Injectable()
export class BranchService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(WarehouseStock)
    private readonly warehouseStockRepository: Repository<WarehouseStock>,
    @InjectRepository(StockMovement)
    private readonly stockMovementRepository: Repository<StockMovement>,
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepository: Repository<SalesInvoice>,
    private readonly excel: ExcelService,
    imports: ImportRegistry,
  ) {
    imports.register('branches', {
      templateFilename: 'branches-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'الفروع',
      title: 'استيراد الفروع',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const companyId = await this.resolveCompanyId();
    const seen = new Set<string>();
    return this.excel.runImport(this.branchRepository.manager.connection, parsed, async (v, manager) => {
      const branchRepo = manager.getRepository(Branch);
      const code = str(v.code, 'الكود');
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await branchRepo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الفرع «${code}» مستخدم بالفعل`);
      }

      const branch = await branchRepo.save(
        branchRepo.create({
          code,
          name: str(v.name, 'الاسم'),
          managerName: optStr(v.managerName),
          phone: optStr(v.phone),
          mobile: optStr(v.mobile),
          email: optStr(v.email),
          country: optStr(v.country),
          city: optStr(v.city),
          address: optStr(v.address),
          notes: optStr(v.notes),
          isMain: false,
          isActive: bool(v.isActive, true),
          companyId,
        }),
      );

      // Match single-create: auto-provision a default warehouse per branch.
      const warehouseRepo = manager.getRepository(Warehouse);
      await warehouseRepo.save(
        warehouseRepo.create({
          code: await this.generateWarehouseCode(branch.code, warehouseRepo),
          name: `مخزن ${branch.name}`,
          type: WarehouseType.STORE,
          branchId: branch.id,
          isDefault: true,
          isActive: true,
        }),
      );
    });
  }

  /**
   * Create a branch and, in the SAME transaction, auto-provision a default
   * warehouse for it (marked `isDefault`), so a new branch is immediately usable
   * by inventory/sales. If the warehouse can't be created the branch is rolled
   * back too. The created warehouse is attached to the returned branch as
   * `defaultWarehouse` for the client.
   */
  async create(dto: CreateBranchDto): Promise<Branch> {
    await this.ensureCodeUnique(dto.code);
    const companyId = await this.resolveCompanyId();

    return this.branchRepository.manager.transaction(async (manager) => {
      if (dto.isMain) {
        await manager.update(Branch, { companyId, isMain: true }, { isMain: false });
      }

      const branchRepo = manager.getRepository(Branch);
      const branch = await branchRepo.save(branchRepo.create({ ...dto, companyId }));

      const warehouseRepo = manager.getRepository(Warehouse);
      const warehouse = await warehouseRepo.save(
        warehouseRepo.create({
          code: await this.generateWarehouseCode(branch.code, warehouseRepo),
          name: `مخزن ${branch.name}`,
          type: WarehouseType.STORE,
          branchId: branch.id,
          isDefault: true,
          isActive: true,
        }),
      );

      (branch as Branch & { defaultWarehouse?: Warehouse }).defaultWarehouse = warehouse;
      return branch;
    });
  }

  async findAll(query: QueryBranchDto): Promise<PaginatedResult<Branch>> {
    const qb = this.branchRepository.createQueryBuilder('branch');

    if (query.search) {
      qb.andWhere('(branch.name LIKE :s OR branch.code LIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('branch.isActive = :active', { active: query.isActive });
    }

    const sortBy = query.sortBy ?? 'createdAt';
    qb.orderBy(`branch.${sortBy}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<Branch> {
    const branch = await this.branchRepository.findOne({ where: { id } });
    if (!branch) {
      throw new NotFoundException('لم يتم العثور على الفرع');
    }
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch> {
    const branch = await this.findOne(id);

    if (dto.code && dto.code !== branch.code) {
      await this.ensureCodeUnique(dto.code, id);
    }

    if (dto.isMain && !branch.isMain) {
      await this.clearMainFlag(branch.companyId, id);
    }

    Object.assign(branch, dto);
    return this.branchRepository.save(branch);
  }

  /**
   * Delete a branch. The main branch is protected. A branch's warehouses (the
   * auto-provisioned default included) are cascade soft-deleted ONLY when they
   * are empty — no stock balances, no stock movements — and nothing references
   * the branch or its warehouses (sales invoices). Any real activity blocks the
   * delete so accounting/inventory history is never orphaned.
   */
  async remove(id: string): Promise<void> {
    const branch = await this.findOne(id);

    if (branch.isMain) {
      throw new BadRequestException('لا يمكن حذف الفرع الرئيسي');
    }

    const warehouses = await this.warehouseRepository.find({
      where: { branchId: id },
    });
    const warehouseIds = warehouses.map((w) => w.id);

    if (warehouseIds.length) {
      const [movements, balances, invoicesByWarehouse] = await Promise.all([
        this.stockMovementRepository.count({
          where: { warehouseId: In(warehouseIds) },
        }),
        this.warehouseStockRepository.count({
          where: { warehouseId: In(warehouseIds) },
        }),
        this.salesInvoiceRepository.count({
          where: { warehouseId: In(warehouseIds) },
        }),
      ]);
      if (movements > 0 || balances > 0) {
        throw new BadRequestException(
          'لا يمكن حذف الفرع لوجود حركة مخزنية في مخازنه',
        );
      }
      if (invoicesByWarehouse > 0) {
        throw new BadRequestException('لا يمكن حذف الفرع لارتباط مخازنه بفواتير');
      }
    }

    const invoicesByBranch = await this.salesInvoiceRepository.count({
      where: { branchId: id },
    });
    if (invoicesByBranch > 0) {
      throw new BadRequestException('لا يمكن حذف الفرع لارتباطه بفواتير');
    }

    // Safe: cascade soft-delete the empty warehouses, then the branch.
    await this.branchRepository.manager.transaction(async (manager) => {
      if (warehouseIds.length) {
        await manager.softDelete(Warehouse, warehouseIds);
      }
      await manager.softDelete(Branch, id);
    });
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.branchRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود الفرع مستخدم بالفعل');
    }
  }

  /**
   * Derive a unique warehouse code from the branch code (`WH-<branchCode>`),
   * appending a suffix if that code is already taken. `withDeleted` guards
   * against colliding with a soft-deleted warehouse (the unique index spans them).
   */
  private async generateWarehouseCode(
    branchCode: string,
    repo: Repository<Warehouse>,
  ): Promise<string> {
    const base = `WH-${branchCode}`;
    let code = base;
    let suffix = 1;
    while (await repo.findOne({ where: { code }, withDeleted: true })) {
      suffix += 1;
      code = `${base}-${suffix}`;
    }
    return code;
  }

  /** Unset the main flag on any other branch of the company. */
  private async clearMainFlag(companyId: string, exceptId?: string): Promise<void> {
    await this.branchRepository.update(
      { companyId, isMain: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      { isMain: false },
    );
  }

  private async resolveCompanyId(): Promise<string> {
    const company = await this.companyRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!company) {
      throw new NotFoundException('لم يتم العثور على بيانات الشركة');
    }
    return company.id;
  }
}
