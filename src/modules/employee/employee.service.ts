import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { BaseCrudService, ListQuery } from '../../common/services/base-crud.service';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, optNum, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'EMP-001', note: 'كود فريد للموظف' },
  { field: 'name', header: 'الاسم', required: true, example: 'أحمد محمد' },
  { field: 'mobile', header: 'الجوال', example: '01000000000' },
  { field: 'nationalId', header: 'الرقم القومي', example: '29001010000000' },
  { field: 'jobTitle', header: 'الوظيفة', example: 'مندوب مبيعات' },
  { field: 'hireDate', header: 'تاريخ التعيين', type: 'date', example: '2025-01-01' },
  { field: 'netSalary', header: 'المرتب الصافي', type: 'number', example: 6000 },
  { field: 'commissionRate', header: 'نسبة العمولة %', type: 'number', example: 2.5 },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class EmployeeService extends BaseCrudService<Employee> {
  protected readonly alias = 'employee';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'mobile', 'phone', 'nationalId', 'jobTitle'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على الموظف';

  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    super(employeeRepository);
    imports.register('employees', {
      templateFilename: 'employees-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const code = await this.codeSettings.resolveCode('employee', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود الموظف مستخدم بالفعل');
    const branches = await this.resolveBranches(dto.branchIds);
    const { branchIds: _bi, ...rest } = dto;
    return this.employeeRepository.save(
      this.employeeRepository.create({ ...rest, code, branches }),
    );
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: { branches: true },
    });
    if (!employee) throw new NotFoundException(this.notFoundMessage);
    if (dto.code && dto.code !== employee.code) {
      await this.ensureUnique('code', dto.code, id, 'كود الموظف مستخدم بالفعل');
    }
    if (dto.branchIds !== undefined) {
      employee.branches = await this.resolveBranches(dto.branchIds);
    }
    const { branchIds: _bi, ...rest } = dto;
    Object.assign(employee, rest);
    return this.employeeRepository.save(employee);
  }

  // Load the branch set on detail + list (the base service loads no relations).
  async findOne(id: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: { branches: true },
    });
    if (!employee) throw new NotFoundException(this.notFoundMessage);
    return employee;
  }

  async findAll(query: ListQuery): Promise<PaginatedResult<Employee>> {
    const qb = this.employeeRepository
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.branches', 'branch');
    if (query.search) {
      const cond = this.searchFields.map((f) => `employee.${f} LIKE :s`).join(' OR ');
      qb.andWhere(`(${cond})`, { s: `%${query.search}%` });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('employee.isActive = :active', { active: query.isActive });
    }
    const sortBy = this.sortableFields.includes(query.sortBy ?? '') ? query.sortBy! : 'createdAt';
    qb.orderBy(`employee.${sortBy}`, query.order).skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
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

  // =========================
  // EXCEL IMPORT
  // =========================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'الموظفون',
      title: 'استيراد الموظفين',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const code = await this.codeSettings.resolveCode('employee', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      const repo = manager.getRepository(Employee);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الموظف «${code}» مستخدم بالفعل`);
      }
      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          mobile: optStr(v.mobile),
          nationalId: optStr(v.nationalId),
          jobTitle: optStr(v.jobTitle),
          hireDate: optStr(v.hireDate),
          netSalary: optNum(v.netSalary, 0),
          commissionRate: optNum(v.commissionRate, 0),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }
}
