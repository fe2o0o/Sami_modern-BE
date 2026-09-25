import { Injectable } from '@nestjs/common';
import { SupplierService } from '../../supplier/supplier.service';
import { SupplierLedgerService } from '../../supplier/supplier-ledger.service';
import { StatusQueryDto } from '../../../common/dto/status-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, listQuery, optStr, optUuid } from './tool-helpers';

/** Supplier read tools. All gated by `suppliers.view`. */
@Injectable()
export class SupplierAiTools {
  constructor(
    private readonly suppliers: SupplierService,
    private readonly ledger: SupplierLedgerService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'search_suppliers',
        description:
          'ابحث عن موردين بالاسم/الكود/الجوال. استخدمها أولاً لتحديد المورد؛ عند تعدد النتائج اطلب من المستخدم الاختيار.',
        permission: 'suppliers.view',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'اسم/كود/جوال المورد' } },
          required: ['query'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const q = optStr(args.query);
          if (!q) return { success: false, code: 'INVALID_ARGS', message: 'اكتب اسم المورد للبحث.' };
          const res = await this.suppliers.findAll(
            listQuery(1, 10, { search: q }) as unknown as StatusQueryDto,
          );
          const rows = res.items.map((s) => ({ id: s.id, code: s.code, name: s.name, mobile: s.mobile }));
          if (rows.length === 0) {
            return { success: false, code: 'SUPPLIER_NOT_FOUND', message: `لا يوجد مورد مطابق لـ "${q}".` };
          }
          return {
            success: true,
            presentation: rows.length > 1 ? 'ambiguous' : 'table',
            data: { entity: 'supplier', count: res.meta.totalItems, results: rows },
          };
        },
      },
      {
        name: 'get_supplier_balance',
        description: 'رصيد المورد الحالي (دائن موجب = مستحق للمورد علينا).',
        permission: 'suppliers.view',
        parameters: {
          type: 'object',
          properties: { supplierId: { type: 'string', description: 'معرّف المورد (uuid)' } },
          required: ['supplierId'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = optUuid(args.supplierId, 'supplierId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف المورد مطلوب.' };
          const s = await this.suppliers.findOne(id);
          const balance = await this.ledger.balance(id);
          return { success: true, presentation: 'report', data: { supplier: { id: s.id, name: s.name }, balance, currency: CURRENCY } };
        },
      },
      {
        name: 'get_supplier_account',
        description: 'كشف حساب المورد: الرصيد الحالي وآخر الحركات (فواتير مشتريات/سندات صرف/مرتجعات).',
        permission: 'suppliers.view',
        parameters: {
          type: 'object',
          properties: {
            supplierId: { type: 'string', description: 'معرّف المورد (uuid)' },
            limit: { type: 'number', description: 'عدد آخر الحركات (افتراضي 20، أقصى 50)' },
          },
          required: ['supplierId'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = optUuid(args.supplierId, 'supplierId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف المورد مطلوب.' };
          const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
          const [s, statement] = await Promise.all([this.suppliers.findOne(id), this.ledger.statement(id)]);
          const recent = statement.transactions.slice(0, limit).map((t) => ({
            date: t.transactionDate,
            type: t.type,
            document: t.sourceNumber,
            debit: t.debit,
            credit: t.credit,
            description: t.description,
          }));
          return {
            success: true,
            presentation: 'report',
            data: {
              title: `كشف حساب المورد: ${s.name}`,
              supplier: { id: s.id, code: s.code, name: s.name },
              balance: statement.balance,
              currency: CURRENCY,
              totalTransactions: statement.transactions.length,
              recentTransactions: recent,
            },
          };
        },
      },
    ];
  }
}
