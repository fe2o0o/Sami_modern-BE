import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { SalesInvoiceCommission } from '../sales-invoice/entities/sales-invoice-commission.entity';
import { SalesInvoiceStatus } from '../sales-invoice/enums/sales-invoice.enum';
import { Employee } from './entities/employee.entity';
import { Branch } from '../branch/entities/branch.entity';
import { User } from '../user/entities/user.entity';
import { Department } from '../hr/entities/department.entity';
import { JobGrade } from '../hr/entities/job-grade.entity';
import { PayComponent } from '../hr/entities/pay-component.entity';
import { EmploymentStatus, EXIT_STATUSES } from '../hr/enums/hr.enum';
import { SalaryService } from '../hr/salary.service';
import { EmployeeHrService } from '../hr/employee-hr.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeQueryDto } from './dto/employee-query.dto';
import { BaseCrudService } from '../../common/services/base-crud.service';
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
  { field: 'netSalary', header: 'المرتب الصافي', type: 'number', example: 6000, note: 'يُسجَّل كراتب أساسي من تاريخ التعيين' },
  { field: 'commissionRate', header: 'نسبة العمولة %', type: 'number', example: 2.5 },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

/** Fields only changed through their own flows (status endpoint, salary packages, photo upload). */
const NOT_EDITABLE = ['isActive', 'netSalary', 'employmentStatus', 'exitDate', 'exitReason', 'photoName'] as const;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

@Injectable()
export class EmployeeService extends BaseCrudService<Employee> {
  protected readonly alias = 'employee';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'mobile', 'phone', 'nationalId', 'jobTitle'];
  protected readonly sortableFields = ['code', 'name', 'createdAt', 'hireDate'];
  protected readonly notFoundMessage = 'لم يتم العثور على الموظف';

  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    private readonly salary: SalaryService,
    private readonly hr: EmployeeHrService,
    imports: ImportRegistry,
  ) {
    super(employeeRepository);
    imports.register('employees', {
      templateFilename: 'employees-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  async create(dto: CreateEmployeeDto, actorId?: string | null): Promise<Employee> {
    const code = await this.codeSettings.resolveCode('employee', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود الموظف مستخدم بالفعل');
    await this.validateProfile(dto);
    const branches = await this.resolveBranches(dto.branchIds);
    const { branchIds: _bi, netSalary, isActive, ...rest } = dto;
    const active = isActive !== false;
    const saved = await this.employeeRepository.save(
      this.employeeRepository.create({
        ...rest,
        code,
        branches,
        isActive: active,
        employmentStatus: active ? EmploymentStatus.ACTIVE : EmploymentStatus.TERMINATED,
        netSalary: 0,
      }),
    );
    // the starting salary becomes the employee's first package («أساسي»)
    if (netSalary && netSalary > 0) await this.startingPackage(saved, netSalary, actorId);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({ where: { id }, relations: { branches: true } });
    if (!employee) throw new NotFoundException(this.notFoundMessage);
    if (dto.code && dto.code !== employee.code) {
      await this.ensureUnique('code', dto.code, id, 'كود الموظف مستخدم بالفعل');
    }
    await this.validateProfile({ ...employee, ...dto }, id);
    if (dto.branchIds !== undefined) employee.branches = await this.resolveBranches(dto.branchIds);
    const rest: Record<string, unknown> = { ...dto };
    delete rest.branchIds;
    for (const k of NOT_EDITABLE) delete rest[k];
    Object.assign(employee, rest);
    await this.employeeRepository.save(employee);
    return this.findOne(id);
  }

  /** Cross-field / reference rules of the HR profile. */
  private async validateProfile(
    v: Partial<Pick<Employee, 'departmentId' | 'jobGradeId' | 'directManagerId' | 'userId' | 'contractStart' | 'contractEnd' | 'hireDate' | 'birthDate'>>,
    selfId?: string,
  ): Promise<void> {
    if (v.contractStart && v.contractEnd && v.contractEnd < v.contractStart) {
      throw new BadRequestException('تاريخ نهاية العقد لا يمكن أن يكون قبل بدايته');
    }
    if (v.birthDate && v.birthDate > today()) throw new BadRequestException('تاريخ الميلاد لا يمكن أن يكون في المستقبل');
    const m = this.dataSource.manager;
    if (v.departmentId && !(await m.exists(Department, { where: { id: v.departmentId } }))) throw new BadRequestException('القسم المختار غير موجود');
    if (v.jobGradeId && !(await m.exists(JobGrade, { where: { id: v.jobGradeId } }))) throw new BadRequestException('الدرجة الوظيفية المختارة غير موجودة');
    if (v.directManagerId) {
      if (v.directManagerId === selfId) throw new BadRequestException('الموظف لا يمكن أن يكون مديراً مباشراً لنفسه');
      if (!(await m.exists(Employee, { where: { id: v.directManagerId } }))) throw new BadRequestException('المدير المباشر المختار غير موجود');
    }
    if (v.userId) {
      if (!(await m.exists(User, { where: { id: v.userId } }))) throw new BadRequestException('مستخدم النظام المختار غير موجود');
      const taken = await this.employeeRepository.findOne({ where: { userId: v.userId } });
      if (taken && taken.id !== selfId) throw new ConflictException(`مستخدم النظام مربوط بالفعل بالموظف «${taken.name}»`);
    }
  }

  private async startingPackage(employee: Employee, netSalary: number, actorId?: string | null): Promise<void> {
    const basic = await this.dataSource.getRepository(PayComponent).findOne({ where: { isBasic: true } });
    if (!basic) return;
    await this.salary.createPackage(
      employee.id,
      { effectiveFrom: employee.hireDate ?? today(), lines: [{ payComponentId: basic.id, value: netSalary }], notes: 'الراتب عند إضافة الموظف' },
      actorId,
    );
  }

  // ── read ──────────────────────────────────────────────
  async findOne(id: string): Promise<Employee> {
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: { branches: true, department: true, jobGrade: true, directManager: true },
    });
    if (!employee) throw new NotFoundException(this.notFoundMessage);
    return employee;
  }

  /** Employee + linked user name (for the profile page). */
  async profile(id: string, scope: string[] | null) {
    const employee = await this.findOne(id);
    this.assertInScope(employee, scope);
    const user = employee.userId
      ? await this.dataSource.getRepository(User).findOne({ where: { id: employee.userId }, select: { id: true, username: true, fullName: true } as never })
      : null;
    return { ...employee, user };
  }

  async findAll(query: EmployeeQueryDto, scope: string[] | null = null): Promise<PaginatedResult<Employee>> {
    await this.salary.syncDueNetSalaries();
    const qb = this.employeeRepository
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.branches', 'branch')
      .leftJoinAndSelect('employee.department', 'department')
      .leftJoinAndSelect('employee.jobGrade', 'jobGrade');
    this.applyListFilters(qb, query, scope);
    const sortBy = this.sortableFields.includes(query.sortBy ?? '') ? query.sortBy! : 'createdAt';
    qb.orderBy(`employee.${sortBy}`, query.order).skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  /** A branch-restricted user sees employees of their branches + those serving all branches. */
  assertInScope(employee: Employee, scope: string[] | null): void {
    if (!scope) return;
    const ids = (employee.branches ?? []).map((b) => b.id);
    if (ids.length && !ids.some((id) => scope.includes(id))) throw new NotFoundException(this.notFoundMessage);
  }

  /** The list's filters (alias `employee`) — list + summary cards. */
  private applyListFilters<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, query: EmployeeQueryDto, scope: string[] | null): void {
    if (query.search) {
      const cond = this.searchFields.map((f) => `employee.${f} LIKE :s`).join(' OR ');
      qb.andWhere(`(${cond})`, { s: `%${query.search}%` });
    }
    if (query.isActive !== undefined) qb.andWhere('employee.isActive = :active', { active: query.isActive });
    if (query.employmentStatus) qb.andWhere('employee.employmentStatus = :st', { st: query.employmentStatus });
    if (query.departmentId) qb.andWhere('employee.departmentId = :dep', { dep: query.departmentId });
    if (query.jobGradeId) qb.andWhere('employee.jobGradeId = :grd', { grd: query.jobGradeId });
    if (query.contractType) qb.andWhere('employee.contractType = :ct', { ct: query.contractType });
    const servesBranch = (param: string) =>
      `(EXISTS (SELECT 1 FROM employee_branches ebf WHERE ebf.employee_id = employee.id AND ebf.branch_id IN (:...${param}))
        OR NOT EXISTS (SELECT 1 FROM employee_branches ebn WHERE ebn.employee_id = employee.id))`;
    if (query.branchId) qb.andWhere(servesBranch('fBranch'), { fBranch: [query.branchId] });
    if (scope) {
      if (!scope.length) qb.andWhere('1 = 0');
      else qb.andWhere(servesBranch('scopeBranches'), { scopeBranches: scope });
    }
  }

  /**
   * Analysis cards for the employees list, over EXACTLY the list's filters.
   * Salaries only when `withSalaries`; commission totals only when `withCommissions`.
   */
  async summary(query: EmployeeQueryDto, opts: { withCommissions: boolean; withSalaries: boolean; withDocuments: boolean }, scope: string[] | null = null) {
    await this.salary.syncDueNetSalaries();
    const qb = this.employeeRepository.createQueryBuilder('employee');
    this.applyListFilters(qb, query, scope);
    const year = new Date().getFullYear();
    const raw = await qb
      .clone()
      .select('COUNT(*)', 'cnt')
      .addSelect('SUM(CASE WHEN employee.isActive = 1 THEN 1 ELSE 0 END)', 'active')
      .addSelect(`SUM(CASE WHEN employee.employmentStatus = '${EmploymentStatus.ON_LEAVE}' THEN 1 ELSE 0 END)`, 'onLeave')
      .addSelect(
        `SUM(CASE WHEN employee.employmentStatus IN ('${EXIT_STATUSES.join("','")}') AND YEAR(employee.exitDate) = ${year} THEN 1 ELSE 0 END)`,
        'exitedThisYear',
      )
      .addSelect(`SUM(CASE WHEN YEAR(employee.hireDate) = ${year} THEN 1 ELSE 0 END)`, 'joinedThisYear')
      .addSelect('SUM(CASE WHEN employee.commissionRate > 0 THEN 1 ELSE 0 END)', 'withRate')
      .addSelect('COALESCE(SUM(CASE WHEN employee.isActive = 1 THEN employee.netSalary ELSE 0 END), 0)', 'salaries')
      .addSelect('SUM(CASE WHEN employee.isActive = 1 AND employee.departmentId IS NULL THEN 1 ELSE 0 END)', 'noDepartment')
      .getRawOne<Record<string, string | null>>();
    const unassigned = await qb.clone().leftJoin('employee.branches', 'branch').andWhere('branch.id IS NULL').getCount();

    let commission: { total: number; invoicesCount: number; employeesCount: number } | null = null;
    if (opts.withCommissions) {
      const cq = this.dataSource
        .getRepository(SalesInvoiceCommission)
        .createQueryBuilder('c')
        .innerJoin('c.salesInvoice', 'si')
        .innerJoin(Employee, 'employee', 'employee.id = c.employeeId')
        .select('COALESCE(SUM(c.amount), 0)', 'total')
        .addSelect('COUNT(DISTINCT c.salesInvoiceId)', 'invoices')
        .addSelect('COUNT(DISTINCT c.employeeId)', 'employees')
        .where('si.status = :posted', { posted: SalesInvoiceStatus.POSTED });
      this.applyListFilters(cq, query, scope);
      const c = await cq.getRawOne<Record<string, string | null>>();
      commission = {
        total: Math.round((Number(c?.total ?? 0) + Number.EPSILON) * 100) / 100,
        invoicesCount: Number(c?.invoices ?? 0) || 0,
        employeesCount: Number(c?.employees ?? 0) || 0,
      };
    }

    let expiringDocuments: number | null = null;
    if (opts.withDocuments) {
      const ids = (await qb.clone().select('employee.id', 'id').getRawMany<{ id: string }>()).map((r) => r.id);
      expiringDocuments = await this.hr.expiringDocumentsCount(ids);
    }

    const n = (k: string) => Number(raw?.[k] ?? 0) || 0;
    return {
      count: n('cnt'),
      activeCount: n('active'),
      onLeaveCount: n('onLeave'),
      exitedThisYear: n('exitedThisYear'),
      joinedThisYear: n('joinedThisYear'),
      noDepartmentCount: n('noDepartment'),
      withCommissionRateCount: n('withRate'),
      allBranchesCount: unassigned,
      activeNetSalaries: opts.withSalaries ? Math.round((n('salaries') + Number.EPSILON) * 100) / 100 : null,
      expiringDocuments,
      commission,
    };
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
    const salaries: { id: string; hireDate: string | null; net: number }[] = [];
    const result = await this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const code = await this.codeSettings.resolveCode('employee', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      const repo = manager.getRepository(Employee);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود الموظف «${code}» مستخدم بالفعل`);
      }
      const active = bool(v.isActive, true);
      const saved = await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          mobile: optStr(v.mobile),
          nationalId: optStr(v.nationalId),
          jobTitle: optStr(v.jobTitle),
          hireDate: optStr(v.hireDate),
          netSalary: 0,
          commissionRate: optNum(v.commissionRate, 0),
          isActive: active,
          employmentStatus: active ? EmploymentStatus.ACTIVE : EmploymentStatus.TERMINATED,
        }),
      );
      const net = optNum(v.netSalary, 0);
      if (net > 0) salaries.push({ id: saved.id, hireDate: saved.hireDate, net });
    });
    // starting salaries become packages once the rows are committed
    for (const s of salaries) {
      const e = await this.employeeRepository.findOne({ where: { id: s.id } });
      if (e) await this.startingPackage(e, s.net);
    }
    return result;
  }
}
