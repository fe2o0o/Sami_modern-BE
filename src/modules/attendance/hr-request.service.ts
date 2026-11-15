import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { BranchScope } from '../../common/utils/branch-scope.util';
import { paginate } from '../../common/utils/pagination.util';
import { HrRequest } from './entities/hr-request.entity';
import { AttendanceService } from './attendance.service';
import { HrRequestStatus, HrRequestType } from './attendance.enum';
import { ApproveAdvanceRequestDto, HrRequestBodyDto, HrRequestUpdateDto, HrRequestsQueryDto } from './dto/leave.dto';
import { AdvanceService } from '../hr/advance.service';
import { EmployeeAdvance } from '../hr/entities/employee-advance.entity';
import { cairoToday } from './attendance-time.util';

const OPEN = [HrRequestStatus.NEW, HrRequestStatus.IN_PROGRESS];

/** Employee → HR requests (advance, certificates, punch correction, complaint…) — a ticket with HR's reply. */
@Injectable()
export class HrRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly attendance: AttendanceService,
    private readonly advances: AdvanceService,
  ) {}

  async create(employeeId: string, dto: HrRequestBodyDto) {
    if (dto.requestType === HrRequestType.ADVANCE && !(Number(dto.amount) > 0)) throw new BadRequestException('اكتب مبلغ السلفة المطلوب');
    const repo = this.dataSource.getRepository(HrRequest);
    const open = await repo.count({ where: OPEN.map((s) => ({ employeeId, status: s })) });
    if (open >= 10) throw new BadRequestException('لديك 10 طلبات مفتوحة — انتظر الرد عليها أولاً');
    return repo.save(
      repo.create({
        employeeId,
        requestType: dto.requestType,
        subject: dto.subject.trim(),
        details: dto.details?.trim() || null,
        amount: dto.requestType === HrRequestType.ADVANCE ? Number(dto.amount) : null,
        status: HrRequestStatus.NEW,
      }),
    );
  }

  async mine(employeeId: string) {
    return this.withAdvance(await this.dataSource.getRepository(HrRequest).find({ where: { employeeId }, order: { createdAt: 'DESC' }, take: 100 }));
  }

  async cancelMine(employeeId: string, id: string) {
    const repo = this.dataSource.getRepository(HrRequest);
    const r = await repo.findOne({ where: { id, employeeId } });
    if (!r) throw new NotFoundException('لم يتم العثور على الطلب');
    if (r.status !== HrRequestStatus.NEW) throw new BadRequestException('يمكن سحب الطلب قبل أن تبدأ الموارد البشرية فيه فقط');
    await repo.update(id, { status: HrRequestStatus.CANCELLED });
    return repo.findOne({ where: { id } });
  }

  private scoped(scope: BranchScope): SelectQueryBuilder<HrRequest> {
    const qb = this.dataSource.getRepository(HrRequest).createQueryBuilder('r').innerJoin('r.employee', 'e').addSelect(['e.id', 'e.code', 'e.name', 'e.jobTitle']);
    if (scope !== null) {
      if (!scope.length) qb.andWhere('1 = 0');
      else
        qb.andWhere(
          '(EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.id AND eb.branch_id IN (:...sc)) OR NOT EXISTS (SELECT 1 FROM employee_branches eb2 WHERE eb2.employee_id = e.id))',
          { sc: scope },
        );
    }
    return qb;
  }

  async list(q: HrRequestsQueryDto, scope: BranchScope) {
    const qb = this.scoped(scope);
    if (q.branchId) {
      qb.andWhere(
        '(EXISTS (SELECT 1 FROM employee_branches eb3 WHERE eb3.employee_id = e.id AND eb3.branch_id = :fb) OR NOT EXISTS (SELECT 1 FROM employee_branches eb4 WHERE eb4.employee_id = e.id))',
        { fb: q.branchId },
      );
    }
    if (q.status) qb.andWhere('r.status = :st', { st: q.status });
    else if (q.open) qb.andWhere('r.status IN (:...op)', { op: OPEN });
    if (q.requestType) qb.andWhere('r.requestType = :rt', { rt: q.requestType });
    if (q.employeeId) qb.andWhere('r.employeeId = :emp', { emp: q.employeeId });
    if (q.search) qb.andWhere('(e.name LIKE :s OR e.code LIKE :s OR r.subject LIKE :s)', { s: `%${q.search}%` });
    // Open first, then newest (many-to-one join only → plain LIMIT/OFFSET is safe).
    qb.addSelect(`CASE r.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END`, 'status_rank')
      .orderBy('status_rank', 'ASC')
      .addOrderBy('r.createdAt', 'DESC')
      .offset(q.skip)
      .limit(q.perPage);
    const [items, total] = await qb.getManyAndCount();
    return paginate(
      await this.withAdvance(items.map(({ employee, ...r }) => ({ ...r, employeeCode: employee?.code, employeeName: employee?.name, jobTitle: employee?.jobTitle ?? null }))),
      total,
      q.page,
      q.perPage,
    );
  }

  openCount(scope: BranchScope) {
    return this.scoped(scope).andWhere('r.status IN (:...op)', { op: OPEN }).getCount();
  }

  async update(id: string, dto: HrRequestUpdateDto, userId: string | undefined, scope: BranchScope) {
    const r = await this.scoped(scope).andWhere('r.id = :id', { id }).getOne();
    if (!r) throw new NotFoundException('لم يتم العثور على الطلب');
    if (!OPEN.includes(r.status)) throw new BadRequestException('الطلب مغلق بالفعل');
    if (r.advanceId && dto.status !== HrRequestStatus.IN_PROGRESS) {
      throw new BadRequestException('الطلب مرتبط بسلفة معتمدة — يُغلق تلقائياً عند صرفها أو إلغائها من صفحة السلف');
    }
    if (r.requestType === HrRequestType.ADVANCE && dto.status === HrRequestStatus.DONE) {
      throw new BadRequestException('لإتمام طلب السلفة استخدم «اعتماد السلفة» — يتم إنشاء السلفة وتُصرف من صفحة السلف');
    }
    if (dto.status === HrRequestStatus.REJECTED && !dto.reply?.trim()) throw new BadRequestException('اكتب سبب الرفض في الرد');
    const repo = this.dataSource.getRepository(HrRequest);
    await repo.update(id, { status: dto.status, reply: dto.reply?.trim() || r.reply, handledByUserId: userId ?? null, handledAt: new Date() });
    return repo.findOne({ where: { id } });
  }

  /**
   * Approve an advance request: creates the employee advance already APPROVED
   * (installment schedule, salary-multiple ceiling) in the same transaction. No
   * money moves — it is paid from the advances page; the request stays «قيد التنفيذ»
   * and closes by itself when the advance is paid (done) or cancelled (rejected).
   */
  async approveAdvance(id: string, dto: ApproveAdvanceRequestDto, userId: string | undefined, scope: BranchScope) {
    const r = await this.scoped(scope).andWhere('r.id = :id', { id }).getOne();
    if (!r) throw new NotFoundException('لم يتم العثور على الطلب');
    if (r.requestType !== HrRequestType.ADVANCE) throw new BadRequestException('هذا الطلب ليس طلب سلفة');
    if (!OPEN.includes(r.status)) throw new BadRequestException('الطلب مغلق بالفعل');
    if (r.advanceId) throw new BadRequestException('تم اعتماد السلفة لهذا الطلب بالفعل');
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(HrRequest, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.advanceId || !OPEN.includes(locked.status)) throw new BadRequestException('تم التعامل مع الطلب بالفعل — حدّث الصفحة');
      const advance = await this.advances.createApproved(
        {
          employeeId: r.employeeId,
          requestDate: cairoToday(),
          amount: dto.amount,
          installmentsCount: dto.installmentsCount,
          firstDeductionMonth: dto.firstDeductionMonth,
          reason: [`طلب من بوابة الموظف: ${r.subject}`, r.details?.trim()].filter(Boolean).join(' — ').slice(0, 1000),
        },
        userId,
        scope,
        manager,
      );
      const reply =
        dto.reply?.trim() ||
        `تمت الموافقة على السلفة بمبلغ ${advance.amount} ج.م على ${advance.installmentsCount} قسط — بانتظار الصرف من الموارد البشرية`;
      await manager.update(HrRequest, id, { status: HrRequestStatus.IN_PROGRESS, advanceId: advance.id, reply, handledByUserId: userId ?? null, handledAt: new Date() });
      return {
        request: await manager.findOne(HrRequest, { where: { id } }),
        advance: { id: advance.id, amount: advance.amount, installmentsCount: advance.installmentsCount, status: advance.status },
      };
    });
  }

  /** Adds the linked advance (number, status) to requests — ERP list and the employee's own list. */
  async withAdvance<T extends { advanceId?: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.advanceId).filter((x): x is string => !!x))];
    const found = ids.length
      ? await this.dataSource.getRepository(EmployeeAdvance).find({
          where: ids.map((id) => ({ id })),
          select: { id: true, advanceNumber: true, status: true, amount: true, paidDate: true, installmentsCount: true },
        })
      : [];
    const byId = new Map(found.map((a) => [a.id, a]));
    return rows.map((r) => {
      const a = r.advanceId ? byId.get(r.advanceId) : undefined;
      return {
        ...r,
        advance: a ? { id: a.id, advanceNumber: a.advanceNumber, status: a.status, amount: a.amount, paidDate: a.paidDate, installmentsCount: a.installmentsCount } : null,
      };
    });
  }
}
