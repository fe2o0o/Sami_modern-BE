import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Brand } from './entities/brand.entity';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { BaseCrudService } from '../../common/services/base-crud.service';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'BR-001', note: 'كود فريد للعلامة' },
  { field: 'name', header: 'الاسم', required: true, example: 'سامسونج' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Samsung' },
  { field: 'description', header: 'الوصف', example: 'وصف اختياري' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class BrandService extends BaseCrudService<Brand> {
  protected readonly alias = 'brand';
  protected readonly searchFields = ['code', 'name', 'nameEn'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على العلامة التجارية';

  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    super(brandRepository);
    imports.register('brands', {
      templateFilename: 'brands-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================
  // EXCEL IMPORT
  // =========================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'العلامات التجارية',
      title: 'استيراد العلامات التجارية',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const code = await this.codeSettings.resolveCode('brand', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      const repo = manager.getRepository(Brand);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود العلامة «${code}» مستخدم بالفعل`);
      }
      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          nameEn: optStr(v.nameEn),
          description: optStr(v.description),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  async create(dto: CreateBrandDto): Promise<Brand> {
    const code = await this.codeSettings.resolveCode('brand', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود العلامة مستخدم بالفعل');
    return this.brandRepository.save(this.brandRepository.create({ ...dto, code }));
  }

  async update(id: string, dto: UpdateBrandDto): Promise<Brand> {
    const brand = await this.findOne(id);
    if (dto.code && dto.code !== brand.code) {
      await this.ensureUnique('code', dto.code, id, 'كود العلامة مستخدم بالفعل');
    }
    Object.assign(brand, dto);
    return this.brandRepository.save(brand);
  }
}
