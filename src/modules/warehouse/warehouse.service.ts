import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { Branch } from '../branch/entities/branch.entity';
import { WarehouseType, WAREHOUSE_TYPE_LABELS } from './enums/warehouse-type.enum';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool, enumFromLabel } from '../../common/excel/import.helpers';
import { CodeSettingService } from '../code-setting/code-setting.service';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'WH-010', note: 'كود فريد للمخزن' },
  { field: 'name', header: 'الاسم', required: true, example: 'المخزن الرئيسي' },
  { field: 'branchCode', header: 'كود الفرع', example: 'BR-001', note: 'كود فرع موجود (اختياري — اتركه فارغاً لمخزن بدون فرع)' },
  { field: 'type', header: 'النوع', example: 'مخزن', note: 'مخزن / معرض / إنتاج / عبور (افتراضي: مخزن)' },
  { field: 'managerName', header: 'اسم المسؤول', example: 'محمد سعيد' },
  { field: 'phone', header: 'الهاتف', example: '0221000000' },
  { field: 'email', header: 'البريد الإلكتروني', example: 'wh@sami.com' },
  { field: 'address', header: 'العنوان', example: '' },
  { field: 'allowNegativeStock', header: 'يسمح بالرصيد السالب', type: 'boolean', example: 'لا' },
  { field: 'isDefault', header: 'افتراضي للفرع', type: 'boolean', example: 'لا', note: 'نعم/لا' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'notes', header: 'ملاحظات', example: '' },
];

@Injectable()
export class WarehouseService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    imports: ImportRegistry,
  ) {
    imports.register('warehouses', {
      templateFilename: 'warehouses-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'المخازن',
      title: 'استيراد المخازن',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.warehouseRepository.manager.connection, parsed, async (v, manager) => {
      const repo = manager.getRepository(Warehouse);
      const code = await this.codeSettings.resolveCode('warehouse', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود المخزن «${code}» مستخدم بالفعل`);
      }

      // Branch is optional — a warehouse with no branch is a central warehouse.
      const branchCode = optStr(v.branchCode);
      let branchId: string | null = null;
      if (branchCode) {
        const branch = await manager.getRepository(Branch).findOne({ where: { code: branchCode } });
        if (!branch) throw new Error(`الفرع بكود «${branchCode}» غير موجود`);
        branchId = branch.id;
      }

      const isDefault = bool(v.isDefault, false);
      if (isDefault && branchId) {
        await manager.update(Warehouse, { branchId, isDefault: true }, { isDefault: false });
      }

      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          branchId,
          type: enumFromLabel<WarehouseType>(v.type, WAREHOUSE_TYPE_LABELS, 'النوع', WarehouseType.STORE),
          managerName: optStr(v.managerName),
          phone: optStr(v.phone),
          email: optStr(v.email),
          address: optStr(v.address),
          allowNegativeStock: bool(v.allowNegativeStock, false),
          isDefault,
          isActive: bool(v.isActive, true),
          notes: optStr(v.notes),
        }),
      );
    });
  }

  async create(dto: CreateWarehouseDto): Promise<Warehouse> {
    const code = await this.codeSettings.resolveCode('warehouse', dto.code);
    if (dto.branchId) await this.ensureBranchExists(dto.branchId);
    await this.ensureCodeUnique(code);

    const warehouse = this.warehouseRepository.create({ ...dto, branchId: dto.branchId ?? null, code });

    // The "default" flag is unique per branch; a branchless warehouse is exempt.
    if (dto.isDefault && dto.branchId) {
      await this.clearDefaultFlag(dto.branchId);
    }

    return this.warehouseRepository.save(warehouse);
  }

  async findAll(query: QueryWarehouseDto): Promise<PaginatedResult<Warehouse>> {
    const qb = this.warehouseRepository
      .createQueryBuilder('warehouse')
      .leftJoinAndSelect('warehouse.branch', 'branch');

    if (query.search) {
      qb.andWhere('(warehouse.name LIKE :s OR warehouse.code LIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    if (query.branchId) {
      qb.andWhere('warehouse.branchId = :branchId', { branchId: query.branchId });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('warehouse.isActive = :active', { active: query.isActive });
    }

    const sortBy = query.sortBy ?? 'createdAt';
    qb.orderBy(`warehouse.${sortBy}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<Warehouse> {
    const warehouse = await this.warehouseRepository.findOne({
      where: { id },
      relations: { branch: true },
    });
    if (!warehouse) {
      throw new NotFoundException('لم يتم العثور على المخزن');
    }
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<Warehouse> {
    const warehouse = await this.findOne(id);

    if (dto.branchId && dto.branchId !== warehouse.branchId) {
      await this.ensureBranchExists(dto.branchId);
    }

    if (dto.code && dto.code !== warehouse.code) {
      await this.ensureCodeUnique(dto.code, id);
    }

    const targetBranchId = dto.branchId ?? warehouse.branchId;
    if (dto.isDefault && !warehouse.isDefault && targetBranchId) {
      await this.clearDefaultFlag(targetBranchId, id);
    }

    Object.assign(warehouse, dto);
    return this.warehouseRepository.save(warehouse);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    // Future: block deletion when stock transactions reference this warehouse.
    if (await this.hasStockTransactions(id)) {
      throw new BadRequestException(
        'لا يمكن حذف المخزن لوجود حركات مخزنية مرتبطة به',
      );
    }

    await this.warehouseRepository.softDelete(id);
  }

  // =========================================================
  // PRIVATE HELPERS
  // =========================================================

  private async ensureBranchExists(branchId: string): Promise<void> {
    const branch = await this.branchRepository.findOne({
      where: { id: branchId },
    });
    if (!branch) {
      throw new NotFoundException('لم يتم العثور على الفرع');
    }
  }

  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.warehouseRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود المخزن مستخدم بالفعل');
    }
  }

  /** Ensure a single default warehouse per branch. */
  private async clearDefaultFlag(branchId: string, exceptId?: string): Promise<void> {
    await this.warehouseRepository.update(
      { branchId, isDefault: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      { isDefault: false },
    );
  }

  /**
   * Placeholder hook — always false until the inventory/stock module exists.
   * Wire this to the stock-movement repository later.
   */
  private async hasStockTransactions(_warehouseId: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
