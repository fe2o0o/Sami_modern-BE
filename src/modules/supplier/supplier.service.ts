import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { BaseCrudService } from '../../common/services/base-crud.service';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, optNum, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', required: true, example: 'S-001', note: 'كود فريد للمورّد' },
  { field: 'name', header: 'الاسم', required: true, example: 'مصنع الخشب' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Wood Factory' },
  { field: 'mobile', header: 'الجوال', example: '01000000000' },
  { field: 'phone', header: 'الهاتف', example: '0221000000' },
  { field: 'email', header: 'البريد الإلكتروني', example: 'info@wood.com' },
  { field: 'taxNumber', header: 'الرقم الضريبي', example: '123-456-789' },
  { field: 'address', header: 'العنوان', example: 'المنطقة الصناعية' },
  { field: 'city', header: 'المدينة', example: 'القاهرة' },
  { field: 'country', header: 'الدولة', example: 'مصر' },
  { field: 'paymentTerms', header: 'مدة السداد (أيام)', type: 'number', example: 30 },
  { field: 'notes', header: 'ملاحظات', example: '' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class SupplierService extends BaseCrudService<Supplier> {
  protected readonly alias = 'supplier';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'mobile', 'phone', 'email'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على المورد';

  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    super(supplierRepository);
    imports.register('suppliers', {
      templateFilename: 'suppliers-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================
  // EXCEL IMPORT
  // =========================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'الموردون',
      title: 'استيراد الموردين',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const code = str(v.code, 'الكود');
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      const repo = manager.getRepository(Supplier);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود المورّد «${code}» مستخدم بالفعل`);
      }
      const paymentTerms = optStr(v.paymentTerms);
      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          nameEn: optStr(v.nameEn),
          mobile: optStr(v.mobile),
          phone: optStr(v.phone),
          email: optStr(v.email),
          taxNumber: optStr(v.taxNumber),
          address: optStr(v.address),
          city: optStr(v.city),
          country: optStr(v.country),
          paymentTerms: paymentTerms === null ? null : optNum(v.paymentTerms, 0),
          notes: optStr(v.notes),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    const code = await this.codeSettings.resolveCode('supplier', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود المورد مستخدم بالفعل');
    return this.supplierRepository.save(this.supplierRepository.create({ ...dto, code }));
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findOne(id);
    if (dto.code && dto.code !== supplier.code) {
      await this.ensureUnique('code', dto.code, id, 'كود المورد مستخدم بالفعل');
    }
    Object.assign(supplier, dto);
    return this.supplierRepository.save(supplier);
  }
}
