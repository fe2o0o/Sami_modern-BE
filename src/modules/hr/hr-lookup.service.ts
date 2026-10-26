import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseCrudService, ListQuery } from '../../common/services/base-crud.service';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { Employee } from '../employee/entities/employee.entity';
import { Department } from './entities/department.entity';
import { JobGrade } from './entities/job-grade.entity';
import { CreateDepartmentDto, CreateJobGradeDto, UpdateDepartmentDto, UpdateJobGradeDto } from './dto/hr-lookup.dto';

/** Company-wide departments (managed list). */
@Injectable()
export class DepartmentService extends BaseCrudService<Department> {
  protected readonly alias = 'department';
  protected readonly searchFields = ['code', 'name', 'nameEn'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على القسم';

  constructor(
    @InjectRepository(Department) private readonly departments: Repository<Department>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly codeSettings: CodeSettingService,
  ) {
    super(departments);
  }

  /** List with the manager and the head-count of each department. */
  async findAll(query: ListQuery): Promise<PaginatedResult<Department & { employeesCount: number }>> {
    const qb = this.departments.createQueryBuilder('department').leftJoinAndSelect('department.managerEmployee', 'manager');
    if (query.search) qb.andWhere('(department.code LIKE :s OR department.name LIKE :s OR department.nameEn LIKE :s)', { s: `%${query.search}%` });
    if (query.isActive !== undefined) qb.andWhere('department.isActive = :a', { a: query.isActive });
    qb.orderBy('department.code', 'ASC').skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    const counts = await this.headCounts('departmentId', items.map((d) => d.id));
    return paginate(items.map((d) => Object.assign(d, { employeesCount: counts.get(d.id) ?? 0 })), total, query.page, query.perPage);
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const code = await this.codeSettings.resolveCode('department', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود القسم مستخدم بالفعل');
    await this.ensureEmployee(dto.managerEmployeeId);
    return this.departments.save(this.departments.create({ ...dto, code }));
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    const department = await this.findOne(id);
    if (dto.code && dto.code !== department.code) await this.ensureUnique('code', dto.code, id, 'كود القسم مستخدم بالفعل');
    await this.ensureEmployee(dto.managerEmployeeId);
    Object.assign(department, dto);
    return this.departments.save(department);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const used = await this.employees.count({ where: { departmentId: id } });
    if (used) throw new BadRequestException(`لا يمكن حذف قسم عليه ${used} موظف — انقلهم لقسم آخر أو أوقف القسم بدلاً من حذفه`);
    await this.departments.softDelete(id);
  }

  private async ensureEmployee(id?: string | null): Promise<void> {
    if (id && !(await this.employees.exists({ where: { id } }))) throw new BadRequestException('مدير القسم المختار غير موجود');
  }

  private async headCounts(field: 'departmentId' | 'jobGradeId', ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.employees
      .createQueryBuilder('e')
      .select(`e.${field}`, 'id')
      .addSelect('COUNT(*)', 'n')
      .where(`e.${field} IN (:...ids)`, { ids })
      .andWhere('e.isActive = 1')
      .groupBy(`e.${field}`)
      .getRawMany<{ id: string; n: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }
}

/** Org-chart node: a job grade with its employees and sub-grades. */
export interface JobGradeNode {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  level: number;
  isActive: boolean;
  parentId: string | null;
  employees: { id: string; name: string; jobTitle: string | null; departmentName: string | null }[];
  children: JobGradeNode[];
}

/**
 * Job grades as a hierarchy (org chart). A grade may report to a parent grade;
 * cycles are refused and `level` (= depth, 1 at the top) is recomputed for the
 * whole tree after every change.
 */
@Injectable()
export class JobGradeService extends BaseCrudService<JobGrade> {
  protected readonly alias = 'grade';
  protected readonly searchFields = ['code', 'name', 'nameEn'];
  protected readonly sortableFields = ['code', 'name', 'level', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على الدرجة الوظيفية';

  constructor(
    @InjectRepository(JobGrade) private readonly grades: Repository<JobGrade>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly codeSettings: CodeSettingService,
  ) {
    super(grades);
  }

  async findAll(query: ListQuery): Promise<PaginatedResult<JobGrade & { employeesCount: number; parentName: string | null }>> {
    const qb = this.grades.createQueryBuilder('grade').leftJoinAndSelect('grade.parent', 'parent');
    if (query.search) qb.andWhere('(grade.code LIKE :s OR grade.name LIKE :s OR grade.nameEn LIKE :s)', { s: `%${query.search}%` });
    if (query.isActive !== undefined) qb.andWhere('grade.isActive = :a', { a: query.isActive });
    qb.orderBy('grade.level', 'ASC').addOrderBy('grade.code', 'ASC').skip(query.skip).take(query.perPage);
    const [items, total] = await qb.getManyAndCount();
    const counts = await this.headCounts(items.map((g) => g.id));
    return paginate(
      items.map((g) => Object.assign(g, { employeesCount: counts.get(g.id) ?? 0, parentName: g.parent?.name ?? null })),
      total,
      query.page,
      query.perPage,
    );
  }

  /** The whole hierarchy with the working employees of each grade (org chart). */
  async tree(): Promise<JobGradeNode[]> {
    const all = await this.grades.find({ order: { level: 'ASC', code: 'ASC' } });
    const emps = await this.employees
      .createQueryBuilder('e')
      .leftJoin('e.department', 'd')
      .select(['e.id AS id', 'e.name AS name', 'e.jobTitle AS jobTitle', 'e.jobGradeId AS gradeId', 'd.name AS departmentName'])
      .where('e.isActive = 1')
      .andWhere('e.jobGradeId IS NOT NULL')
      .orderBy('e.name', 'ASC')
      .getRawMany<{ id: string; name: string; jobTitle: string | null; gradeId: string; departmentName: string | null }>();
    const byGrade = new Map<string, JobGradeNode['employees']>();
    for (const e of emps) {
      const list = byGrade.get(e.gradeId) ?? [];
      list.push({ id: e.id, name: e.name, jobTitle: e.jobTitle, departmentName: e.departmentName });
      byGrade.set(e.gradeId, list);
    }
    const nodes = new Map<string, JobGradeNode>(
      all.map((g) => [
        g.id,
        { id: g.id, code: g.code, name: g.name, nameEn: g.nameEn, level: g.level, isActive: g.isActive, parentId: g.parentId, employees: byGrade.get(g.id) ?? [], children: [] },
      ]),
    );
    const roots: JobGradeNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentId ? nodes.get(n.parentId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return roots;
  }

  async create(dto: CreateJobGradeDto): Promise<JobGrade> {
    const code = await this.codeSettings.resolveCode('job_grade', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود الدرجة مستخدم بالفعل');
    await this.ensureParent(dto.parentId ?? null);
    const saved = await this.grades.save(this.grades.create({ ...dto, code, parentId: dto.parentId ?? null }));
    await this.recomputeLevels();
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateJobGradeDto): Promise<JobGrade> {
    const grade = await this.findOne(id);
    if (dto.code && dto.code !== grade.code) await this.ensureUnique('code', dto.code, id, 'كود الدرجة مستخدم بالفعل');
    if (dto.parentId !== undefined) await this.ensureParent(dto.parentId, id);
    Object.assign(grade, dto);
    await this.grades.save(grade);
    await this.recomputeLevels();
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const children = await this.grades.count({ where: { parentId: id } });
    if (children) throw new BadRequestException(`لا يمكن حذف درجة تحتها ${children} درجة — انقل الدرجات التابعة أو احذفها أولاً`);
    const used = await this.employees.count({ where: { jobGradeId: id } });
    if (used) throw new BadRequestException(`لا يمكن حذف درجة عليها ${used} موظف — غيّر درجتهم أو أوقف الدرجة بدلاً من حذفها`);
    await this.grades.softDelete(id);
    await this.recomputeLevels();
  }

  /** The parent must exist and must not be the grade itself or one of its descendants. */
  private async ensureParent(parentId: string | null, selfId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === selfId) throw new BadRequestException('الدرجة لا يمكن أن تتبع نفسها');
    const all = await this.grades.find({ select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((g) => [g.id, g.parentId]));
    if (!parentOf.has(parentId)) throw new BadRequestException('الدرجة الأعلى المختارة غير موجودة');
    if (selfId) {
      // walk up from the new parent: reaching `selfId` would close a loop
      let cur: string | null | undefined = parentId;
      for (let guard = 0; cur && guard < 1000; guard++) {
        if (cur === selfId) throw new BadRequestException('لا يمكن نقل الدرجة تحت إحدى الدرجات التابعة لها');
        cur = parentOf.get(cur);
      }
    }
  }

  /** level = depth in the tree (1 = top). Small table — recompute everything. */
  private async recomputeLevels(): Promise<void> {
    const all = await this.grades.find({ select: { id: true, parentId: true, level: true } });
    const parentOf = new Map(all.map((g) => [g.id, g.parentId]));
    const depth = (id: string): number => {
      let d = 1;
      let cur = parentOf.get(id);
      for (let guard = 0; cur && parentOf.has(cur) && guard < 1000; guard++) {
        d++;
        cur = parentOf.get(cur);
      }
      return d;
    };
    for (const g of all) {
      const level = depth(g.id);
      if (g.level !== level) await this.grades.update(g.id, { level });
    }
  }

  private async headCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.employees
      .createQueryBuilder('e')
      .select('e.jobGradeId', 'id')
      .addSelect('COUNT(*)', 'n')
      .where('e.jobGradeId IN (:...ids)', { ids })
      .andWhere('e.isActive = 1')
      .groupBy('e.jobGradeId')
      .getRawMany<{ id: string; n: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }
}
