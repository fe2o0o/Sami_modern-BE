import { Injectable } from '@nestjs/common';
import { EmployeeService } from '../../employee/employee.service';
import { EmployeeCommissionReportService } from '../../employee/employee-commission-report.service';
import { CommissionReportQueryDto } from '../../employee/dto/commission-report-query.dto';
import { StatusQueryDto } from '../../../common/dto/status-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optBool, optStr, optUuid, pageArgs } from './tool-helpers';

/** Employees + sales commissions. Permissions mirror employee.controller.ts. */
@Injectable()
export class EmployeeAiTools {
  constructor(
    private readonly employees: EmployeeService,
    private readonly commissions: EmployeeCommissionReportService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_employees',
        description: 'قائمة الموظفين (الكود، الاسم، المسمى الوظيفي، الجوال، صافي الراتب، نسبة العمولة الافتراضية، الفروع، نشط). بحث بالاسم/الكود وفلتر نشط. مرقّمة.',
        permission: 'employees.view',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'اسم أو كود الموظف' },
            isActive: { type: 'boolean' },
            page: { type: 'number' },
            perPage: { type: 'number', description: 'حد أقصى 50' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const { page, perPage } = pageArgs(args, 20, 50);
          const query = listQuery(page, perPage, { search: optStr(args.search), isActive: optBool(args.isActive) }) as unknown as StatusQueryDto;
          const res = await this.employees.findAll(query, ctx.branchScope ?? null);
          const seeSalary = ctx.isSuperAdmin || ctx.permissions.includes('hr_salary.view');
          const rows = res.items.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.name,
            jobTitle: e.jobTitle,
            mobile: e.mobile,
            netSalary: seeSalary ? e.netSalary : null,
            department: e.department?.name ?? null,
            employmentStatus: e.employmentStatus,
            commissionRate: e.commissionRate,
            branches: e.branches?.length ? e.branches.map((b) => b.name).join('، ') : 'كل الفروع',
            isActive: e.isActive,
          }));
          return {
            success: true,
            presentation: 'table',
            data: { title: 'الموظفون', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, employees: rows },
          };
        },
      },
      {
        name: 'get_employees_summary',
        description:
          'ملخص الموظفين: العدد والنشطين ومن لهم نسبة عمولة ومن يعملون في كل الفروع وإجمالي صافي رواتب النشطين؛ ولمن يملك صلاحية التقارير أيضاً إجمالي العمولات (من فواتير البيع المُرحّلة) وعدد الفواتير والموظفين أصحاب العمولات.',
        permission: 'employees.view',
        parameters: {
          type: 'object',
          properties: { search: { type: 'string', description: 'اسم أو كود الموظف' }, isActive: { type: 'boolean' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          // Same rule as EmployeeController.summary: commissions only for report viewers.
          const canSeeCommissions = ctx.isSuperAdmin || ctx.permissions.includes('accounting_reports.view');
          const query = { search: optStr(args.search), isActive: optBool(args.isActive) } as StatusQueryDto;
          const has = (k: string) => ctx.isSuperAdmin || ctx.permissions.includes(k);
          const data = await this.employees.summary(query, { withCommissions: canSeeCommissions, withSalaries: has('hr_salary.view'), withDocuments: has('hr_documents.view') });
          return { success: true, presentation: 'report', data: { title: 'ملخص الموظفين', currency: CURRENCY, ...data } };
        },
      },
      {
        name: 'get_employee_commissions',
        description:
          'تقرير عمولات الموظفين خلال فترة (من سطور العمولة في فواتير البيع المُرحّلة فقط): لكل موظف عدد الفواتير وإجمالي المبيعات وإجمالي العمولة ومتوسط النسبة المُدخلة (avgRate) والنسبة الفعلية (effectiveRate)، مع الإجمالي العام. الفترة مطلوبة؛ إن لم يحددها المستخدم استخدم الشهر الحالي. يمكن تحديد موظف (معرّفه من get_employees).',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            employeeId: { type: 'string', description: 'معرّف الموظف (uuid) — اختياري' },
          },
          required: ['dateFrom', 'dateTo'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const dateFrom = normalizeDate(args.dateFrom, 'dateFrom');
          const dateTo = normalizeDate(args.dateTo, 'dateTo');
          if (!dateFrom || !dateTo) return { success: false, code: 'INVALID_ARGS', message: 'حدّد بداية ونهاية الفترة.' };
          const q = { dateFrom, dateTo, employeeId: optUuid(args.employeeId, 'employeeId') } as CommissionReportQueryDto;
          const res = await this.commissions.generate(q, ctx.branchScope);
          return {
            success: true,
            presentation: 'report',
            data: { title: 'تقرير عمولات الموظفين', currency: CURRENCY, period: res.period, totalSales: res.totalSales, totalCommission: res.total, commissions: res.rows },
          };
        },
      },
      {
        name: 'get_employee_commission_details',
        description:
          'تفاصيل عمولات موظف واحد خلال فترة: كل فاتورة بيع عليها عمولة له (رقم الفاتورة، التاريخ، العميل، الفرع، قيمة الفاتورة، نوع العمولة والنسبة/المبلغ، العمولة، الشركاء في العمولة، الحالة) مع ملخص (المبيعات، العمولة، متوسط النسبة، النسبة الفعلية) وتوزيع شهري. الملخص من الفواتير المرحّلة فقط؛ المسودات تظهر منفصلة. employeeId مطلوب (من get_employees).',
        permission: 'accounting_reports.view',
        parameters: {
          type: 'object',
          properties: {
            employeeId: { type: 'string', description: 'معرّف الموظف (uuid)' },
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
          },
          required: ['employeeId', 'dateFrom', 'dateTo'],
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const dateFrom = normalizeDate(args.dateFrom, 'dateFrom');
          const dateTo = normalizeDate(args.dateTo, 'dateTo');
          const employeeId = optUuid(args.employeeId, 'employeeId');
          if (!dateFrom || !dateTo || !employeeId) return { success: false, code: 'INVALID_ARGS', message: 'حدّد الموظف وبداية ونهاية الفترة.' };
          const res = await this.commissions.details(employeeId, { dateFrom, dateTo } as CommissionReportQueryDto, ctx.branchScope);
          return {
            success: true,
            presentation: 'report',
            data: { title: `عمولات ${res.employee.name}`, currency: CURRENCY, ...res, invoices: res.invoices.slice(0, 50) },
          };
        },
      },
    ];
  }
}
