import { Injectable } from '@nestjs/common';
import { CustomerService } from '../../customer/customer.service';
import { CustomerLedgerService } from '../../customer/customer-ledger.service';
import { StatusQueryDto } from '../../../common/dto/status-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, listQuery, optStr, optUuid } from './tool-helpers';

/** Customer read tools. All gated by `customers.view`. */
@Injectable()
export class CustomerAiTools {
  constructor(
    private readonly customers: CustomerService,
    private readonly ledger: CustomerLedgerService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'search_customers',
        description:
          'ابحث عن عملاء بالاسم أو الكود أو الجوال. استخدمها أولاً لتحديد العميل؛ لو رجعت أكثر من نتيجة اطلب من المستخدم اختيار العميل الصحيح.',
        permission: 'customers.view',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'اسم/كود/جوال العميل' } },
          required: ['query'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const q = optStr(args.query);
          if (!q) return { success: false, code: 'INVALID_ARGS', message: 'اكتب اسم العميل للبحث.' };
          const res = await this.customers.findAll(
            listQuery(1, 10, { search: q }) as unknown as StatusQueryDto,
          );
          const rows = res.items.map((c) => ({ id: c.id, code: c.code, name: c.name, mobile: c.mobile }));
          if (rows.length === 0) {
            return { success: false, code: 'CUSTOMER_NOT_FOUND', message: `لا يوجد عميل مطابق لـ "${q}".` };
          }
          return {
            success: true,
            presentation: rows.length > 1 ? 'ambiguous' : 'table',
            data: { entity: 'customer', count: res.meta.totalItems, results: rows },
          };
        },
      },
      {
        name: 'get_customer',
        description: 'عرض بيانات عميل بالمعرّف (id).',
        permission: 'customers.view',
        parameters: {
          type: 'object',
          properties: { customerId: { type: 'string', description: 'معرّف العميل (uuid)' } },
          required: ['customerId'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = optUuid(args.customerId, 'customerId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف العميل مطلوب.' };
          const c = await this.customers.findOne(id);
          return {
            success: true,
            presentation: 'report',
            data: {
              entity: 'customer',
              id: c.id,
              code: c.code,
              name: c.name,
              mobile: c.mobile,
              phone: c.phone,
              email: c.email,
              city: c.city,
              creditLimit: c.creditLimit,
              isActive: c.isActive,
            },
          };
        },
      },
      {
        name: 'get_customer_balance',
        description: 'رصيد العميل الحالي (مدين موجب = مستحق على العميل).',
        permission: 'customers.view',
        parameters: {
          type: 'object',
          properties: { customerId: { type: 'string', description: 'معرّف العميل (uuid)' } },
          required: ['customerId'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = optUuid(args.customerId, 'customerId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف العميل مطلوب.' };
          const c = await this.customers.findOne(id);
          const balance = await this.ledger.balance(id);
          return {
            success: true,
            presentation: 'report',
            data: { customer: { id: c.id, name: c.name }, balance, currency: CURRENCY, side: balance >= 0 ? 'مدين' : 'دائن' },
          };
        },
      },
      {
        name: 'get_customer_account',
        description:
          'كشف حساب العميل: الرصيد الحالي وآخر الحركات (فواتير/سندات قبض/مرتجعات). استخدمها بعد تحديد العميل بالمعرّف.',
        permission: 'customers.view',
        parameters: {
          type: 'object',
          properties: {
            customerId: { type: 'string', description: 'معرّف العميل (uuid)' },
            limit: { type: 'number', description: 'عدد آخر الحركات (افتراضي 20، أقصى 50)' },
          },
          required: ['customerId'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const id = optUuid(args.customerId, 'customerId');
          if (!id) return { success: false, code: 'INVALID_ARGS', message: 'معرّف العميل مطلوب.' };
          const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
          const [c, statement] = await Promise.all([this.customers.findOne(id), this.ledger.statement(id)]);
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
              title: `كشف حساب العميل: ${c.name}`,
              customer: { id: c.id, code: c.code, name: c.name },
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
