import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Unit } from './entities/unit.entity';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { BaseCrudService } from '../../common/services/base-crud.service';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', required: true, example: 'PCS', note: 'كود فريد للوحدة' },
  { field: 'name', header: 'الاسم', required: true, example: 'قطعة' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Piece' },
  { field: 'symbol', header: 'الرمز', example: 'pcs' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class UnitService extends BaseCrudService<Unit> {
  protected readonly alias = 'unit';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'symbol'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على الوحدة';

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    super(unitRepository);
    imports.register('units', {
      templateFilename: 'units-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================
  // EXCEL IMPORT
  // =========================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'وحدات القياس',
      title: 'استيراد وحدات القياس',
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
      const repo = manager.getRepository(Unit);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الوحدة «${code}» مستخدم بالفعل`);
      }
      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          nameEn: optStr(v.nameEn),
          symbol: optStr(v.symbol),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  async create(dto: CreateUnitDto): Promise<Unit> {
    const code = await this.codeSettings.resolveCode('unit', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود الوحدة مستخدم بالفعل');
    return this.unitRepository.save(this.unitRepository.create({ ...dto, code }));
  }

  async update(id: string, dto: UpdateUnitDto): Promise<Unit> {
    const unit = await this.findOne(id);
    if (dto.code && dto.code !== unit.code) {
      await this.ensureUnique('code', dto.code, id, 'كود الوحدة مستخدم بالفعل');
    }
    Object.assign(unit, dto);
    return this.unitRepository.save(unit);
  }
}
