import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Employee } from '../employee/entities/employee.entity';
import { PayComponent } from './entities/pay-component.entity';
import { SalaryPackage, SalaryPackageLine } from './entities/salary-package.entity';
import { CreatePayComponentDto, CreateSalaryPackageDto, UpdatePayComponentDto } from './dto/salary.dto';
import { PayCalcType, PayComponentType } from './enums/hr.enum';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

export interface SalaryStructureQuery {
  search?: string;
  branchId?: string;
  departmentId?: string;
  branchScope?: string[] | null;
}

/**
 * Salary structure (phase 2): the pay-components catalogue and each employee's
 * packages effective from a date. A raise = a new package; history is kept.
 * The employee's `netSalary` mirrors the package effective TODAY.
 * No journal entries here — posting starts with payroll.
 */
@Injectable()
export class SalaryService {
  constructor(
    @InjectRepository(PayComponent) private readonly components: Repository<PayComponent>,
    @InjectRepository(SalaryPackage) private readonly packages: Repository<SalaryPackage>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
  ) {}

  // ── pay components ─────────────────────────────────────
  listComponents(includeInactive = true): Promise<PayComponent[]> {
    return this.components.find({
      where: includeInactive ? {} : { isActive: true },
      order: { componentType: 'ASC', sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async createComponent(dto: CreatePayComponentDto): Promise<PayComponent> {
    const code = await this.codeSettings.resolveCode('pay_component', dto.code);
    if (await this.components.exists({ where: { code } })) throw new ConflictException('كود البند مستخدم بالفعل');
    await this.ensureAccount(dto.accountId);
    return this.components.save(this.components.create({ ...dto, code, isBasic: false }));
  }

  async updateComponent(id: string, dto: UpdatePayComponentDto): Promise<PayComponent> {
    const c = await this.components.findOne({ where: { id } });
    if (!c) throw new NotFoundException('لم يتم العثور على بند الراتب');
    if (dto.code && dto.code !== c.code && (await this.components.exists({ where: { code: dto.code } }))) {
      throw new ConflictException('كود البند مستخدم بالفعل');
    }
    if (c.isBasic) {
      // the basic salary is always a fixed earning and stays active
      if (dto.componentType && dto.componentType !== PayComponentType.EARNING) throw new BadRequestException('الراتب الأساسي لازم يكون استحقاقاً');
      if (dto.calcType && dto.calcType !== PayCalcType.FIXED) throw new BadRequestException('الراتب الأساسي لازم يكون مبلغاً ثابتاً');
      if (dto.isActive === false) throw new BadRequestException('لا يمكن إيقاف بند الراتب الأساسي');
    }
    await this.ensureAccount(dto.accountId);
    Object.assign(c, dto);
    return this.components.save(c);
  }

  async removeComponent(id: string): Promise<void> {
    const c = await this.components.findOne({ where: { id } });
    if (!c) throw new NotFoundException('لم يتم العثور على بند الراتب');
    if (c.isBasic) throw new BadRequestException('لا يمكن حذف بند الراتب الأساسي');
    const used = await this.dataSource.getRepository(SalaryPackageLine).count({ where: { payComponentId: id } });
    if (used) throw new BadRequestException('البند مستخدم في رواتب موظفين — أوقفه بدلاً من حذفه');
    await this.components.softDelete(id);
  }

  private async ensureAccount(id?: string | null): Promise<void> {
    if (!id) return;
    const acc = await this.dataSource.getRepository(ChartOfAccount).findOne({ where: { id } });
    if (!acc || !acc.allowPosting || acc.isHeader) throw new BadRequestException('الحساب المحاسبي المختار غير موجود أو لا يقبل الترحيل');
  }

  // ── packages ───────────────────────────────────────────
  /** All packages of an employee, newest first, with the one effective today flagged. */
  async employeePackages(employeeId: string) {
    if (!(await this.employees.exists({ where: { id: employeeId } }))) throw new NotFoundException('لم يتم العثور على الموظف');
    const list = await this.packages.find({
      where: { employeeId },
      relations: { lines: { payComponent: true } },
      order: { effectiveFrom: 'DESC' },
    });
    const t = today();
    const currentId = list.find((p) => p.effectiveFrom <= t)?.id ?? null;
    return list.map((p) => ({
      ...p,
      lines: [...p.lines].sort((a, b) => this.lineOrder(a) - this.lineOrder(b)),
      state: p.id === currentId ? 'current' : p.effectiveFrom > t ? 'upcoming' : 'past',
    }));
  }

  private lineOrder(l: SalaryPackageLine): number {
    const c = l.payComponent;
    return (c?.isBasic ? 0 : c?.componentType === PayComponentType.EARNING ? 1000 : 2000) + (c?.sortOrder ?? 0);
  }

  async createPackage(employeeId: string, dto: CreateSalaryPackageDto, actorId?: string | null) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager.findOne(Employee, { where: { id: employeeId }, lock: { mode: 'pessimistic_write' } });
      if (!employee) throw new NotFoundException('لم يتم العثور على الموظف');
      if (await manager.exists(SalaryPackage, { where: { employeeId, effectiveFrom: dto.effectiveFrom } })) {
        throw new ConflictException('يوجد راتب بنفس تاريخ السريان — عدّل التاريخ أو احذف الراتب الموجود');
      }

      const ids = [...new Set(dto.lines.map((l) => l.payComponentId))];
      if (ids.length !== dto.lines.length) throw new BadRequestException('بند الراتب مكرر في نفس الراتب');
      const comps = await manager.find(PayComponent, { where: { id: In(ids) } });
      const byId = new Map(comps.map((c) => [c.id, c]));
      if (comps.length !== ids.length) throw new BadRequestException('أحد بنود الراتب المختارة غير موجود');
      const basicLine = dto.lines.find((l) => byId.get(l.payComponentId)!.isBasic);
      if (!basicLine) throw new BadRequestException('بند الراتب الأساسي مطلوب في كل راتب');
      const basic = round2(basicLine.value);

      let earnings = 0;
      let deductions = 0;
      const lines = dto.lines.map((l) => {
        const c = byId.get(l.payComponentId)!;
        if (c.calcType === PayCalcType.PERCENT_OF_BASIC && l.value > 100) {
          throw new BadRequestException(`نسبة «${c.name}» لا يمكن أن تتجاوز 100%`);
        }
        const amount = c.calcType === PayCalcType.PERCENT_OF_BASIC ? round2((basic * l.value) / 100) : round2(l.value);
        if (c.componentType === PayComponentType.EARNING) earnings += amount;
        else deductions += amount;
        return manager.getRepository(SalaryPackageLine).create({ payComponentId: c.id, value: round2(l.value), amount });
      });
      const net = round2(earnings - deductions);
      if (net < 0) throw new BadRequestException('الاستقطاعات أكبر من الاستحقاقات — صافي الراتب سالب');

      const saved = await manager.getRepository(SalaryPackage).save(
        manager.getRepository(SalaryPackage).create({
          employeeId,
          effectiveFrom: dto.effectiveFrom,
          totalEarnings: round2(earnings),
          totalDeductions: round2(deductions),
          netSalary: net,
          notes: dto.notes?.trim() || null,
          createdBy: actorId ?? null,
          lines,
        }),
      );
      await this.syncNetSalary(employeeId, manager);
      return saved;
    });
  }

  async removePackage(employeeId: string, packageId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const p = await manager.findOne(SalaryPackage, { where: { id: packageId, employeeId } });
      if (!p) throw new NotFoundException('لم يتم العثور على الراتب');
      await manager.delete(SalaryPackageLine, { salaryPackageId: p.id });
      await manager.delete(SalaryPackage, { id: p.id });
      await this.syncNetSalary(employeeId, manager);
    });
  }

  /** employees.netSalary = net of the package effective today (0 when none). */
  private async syncNetSalary(employeeId: string, manager = this.dataSource.manager): Promise<void> {
    const current = await manager
      .getRepository(SalaryPackage)
      .createQueryBuilder('p')
      .where('p.employeeId = :id', { id: employeeId })
      .andWhere('p.effectiveFrom <= :t', { t: today() })
      .orderBy('p.effectiveFrom', 'DESC')
      .getOne();
    await manager.update(Employee, { id: employeeId }, { netSalary: current ? current.netSalary : 0 });
  }

  /** Re-sync every employee whose package took effect since it was saved (call on read of lists). */
  async syncDueNetSalaries(): Promise<void> {
    await this.dataSource.query(
      `UPDATE employees e
          JOIN (SELECT sp.employee_id, sp.net_salary
                  FROM salary_packages sp
                  JOIN (SELECT employee_id, MAX(effective_from) mx FROM salary_packages
                         WHERE deleted_at IS NULL AND effective_from <= CURDATE() GROUP BY employee_id) cur
                    ON cur.employee_id = sp.employee_id AND cur.mx = sp.effective_from
                 WHERE sp.deleted_at IS NULL) c ON c.employee_id = e.id
          SET e.net_salary = c.net_salary
        WHERE e.net_salary <> c.net_salary`,
    );
  }

  // ── salary structure report ────────────────────────────
  /** Every (non-exited) employee with the components of the package effective today. */
  async structure(q: SalaryStructureQuery) {
    await this.syncDueNetSalaries();
    const comps = await this.listComponents(false);
    const qb = this.employees
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.department', 'department')
      .where('e.isActive = 1');
    if (q.search) qb.andWhere('(e.code LIKE :s OR e.name LIKE :s)', { s: `%${q.search}%` });
    if (q.departmentId) qb.andWhere('e.departmentId = :d', { d: q.departmentId });
    if (q.branchId) {
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id = :br)
          OR NOT EXISTS (SELECT 1 FROM employee_branches ebx WHERE ebx.employee_id = e.id))`,
        { br: q.branchId },
      );
    }
    if (q.branchScope) {
      if (!q.branchScope.length) qb.andWhere('1 = 0');
      else
        qb.andWhere(
          `(EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id AND eb2.branch_id IN (:...scope))
            OR NOT EXISTS (SELECT 1 FROM employee_branches eb3 WHERE eb3.employee_id = e.id))`,
          { scope: q.branchScope },
        );
    }
    const emps = await qb.orderBy('e.code', 'ASC').getMany();
    const t = today();
    const pkgs = emps.length
      ? await this.packages
          .createQueryBuilder('p')
          .leftJoinAndSelect('p.lines', 'l')
          .where('p.employeeId IN (:...ids)', { ids: emps.map((e) => e.id) })
          .andWhere('p.effectiveFrom <= :t', { t })
          .orderBy('p.effectiveFrom', 'DESC')
          .getMany()
      : [];
    const current = new Map<string, SalaryPackage>();
    for (const p of pkgs) if (!current.has(p.employeeId)) current.set(p.employeeId, p);

    const rows = emps.map((e) => {
      const p = current.get(e.id);
      const amounts: Record<string, number> = {};
      for (const l of p?.lines ?? []) amounts[l.payComponentId] = l.amount;
      return {
        employeeId: e.id,
        code: e.code,
        name: e.name,
        departmentName: e.department?.name ?? null,
        effectiveFrom: p?.effectiveFrom ?? null,
        amounts,
        totalEarnings: p?.totalEarnings ?? 0,
        totalDeductions: p?.totalDeductions ?? 0,
        netSalary: p?.netSalary ?? 0,
      };
    });
    return {
      components: comps.map((c) => ({ id: c.id, code: c.code, name: c.name, nameEn: c.nameEn, componentType: c.componentType, isBasic: c.isBasic })),
      rows,
      totals: {
        employees: rows.length,
        withoutPackage: rows.filter((r) => !r.effectiveFrom).length,
        totalEarnings: round2(rows.reduce((s, r) => s + r.totalEarnings, 0)),
        totalDeductions: round2(rows.reduce((s, r) => s + r.totalDeductions, 0)),
        netSalary: round2(rows.reduce((s, r) => s + r.netSalary, 0)),
      },
    };
  }
}
