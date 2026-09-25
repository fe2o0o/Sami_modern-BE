import { Injectable } from '@nestjs/common';
import { AiToolDefinition } from '../types/ai.types';
import { optStr } from './tool-helpers';

interface NavScreen {
  section: string;
  screen: string;
  route: string;
  description: string;
  permission?: string;
}

/**
 * Static navigation map — derived from the REAL Angular routes
 * (src/app/app.routes.ts). Never invent routes; only what's listed here exists.
 */
const NAV_MAP: NavScreen[] = [
  { section: 'الرئيسية', screen: 'لوحة المعلومات', route: '/app/dashboard', description: 'مؤشرات ومبيعات ومشتريات ومخزون سريعة' },

  { section: 'المالية', screen: 'الأرصدة الافتتاحية', route: '/app/financial/opening-balances', description: 'إدخال الأرصدة الافتتاحية', permission: 'opening_balances.view' },
  { section: 'المالية', screen: 'قيود اليومية', route: '/app/financial/journal-entries', description: 'عرض وإنشاء القيود المحاسبية', permission: 'journal_entries.view' },
  { section: 'المالية', screen: 'السندات (قبض/صرف)', route: '/app/financial/vouchers', description: 'سندات القبض والصرف', permission: 'vouchers.view' },

  { section: 'المبيعات', screen: 'فواتير المبيعات', route: '/app/sales/invoices', description: 'إنشاء وعرض فواتير البيع', permission: 'sales_invoices.view' },
  { section: 'المبيعات', screen: 'مردودات المبيعات', route: '/app/sales/returns', description: 'مرتجعات العملاء', permission: 'sales_returns.view' },
  { section: 'المبيعات', screen: 'أذون التسليم', route: '/app/sales/deliveries', description: 'تسليم الأصناف المباعة', permission: 'sales_deliveries.view' },

  { section: 'المشتريات', screen: 'فواتير المشتريات', route: '/app/purchases/invoices', description: 'فواتير الشراء من الموردين', permission: 'purchase_invoices.view' },
  { section: 'المشتريات', screen: 'مردودات المشتريات', route: '/app/purchases/returns', description: 'مرتجعات للموردين', permission: 'purchase_returns.view' },

  { section: 'المخزون', screen: 'أرصدة المخزون', route: '/app/inventory/balances', description: 'الكميات المتاحة ومتوسط التكلفة', permission: 'stock.view' },
  { section: 'المخزون', screen: 'حركات المخزون', route: '/app/inventory/movements', description: 'سجل الوارد والصادر', permission: 'stock.view' },
  { section: 'المخزون', screen: 'تسويات المخزون', route: '/app/inventory/adjustments', description: 'تعديل الأرصدة', permission: 'inventory_adjustments.view' },
  { section: 'المخزون', screen: 'التحويلات', route: '/app/inventory/transfers', description: 'تحويل بين المخازن', permission: 'stock_transfers.view' },

  { section: 'التصنيع', screen: 'أوامر التصنيع', route: '/app/manufacturing/orders', description: 'أوامر الإنتاج والمكوّنات', permission: 'manufacturing.view' },

  { section: 'التقارير', screen: 'الأستاذ العام', route: '/app/accounting/general-ledger', description: 'حركة وأرصدة حساب', permission: 'accounting_reports.view' },
  { section: 'التقارير', screen: 'ميزان المراجعة', route: '/app/accounting/trial-balance', description: 'أرصدة كل الحسابات', permission: 'accounting_reports.view' },
  { section: 'التقارير', screen: 'قائمة الدخل', route: '/app/accounting/income-statement', description: 'الأرباح والخسائر', permission: 'accounting_reports.view' },
  { section: 'التقارير', screen: 'الميزانية العمومية', route: '/app/accounting/balance-sheet', description: 'الأصول والخصوم وحقوق الملكية', permission: 'accounting_reports.view' },
  { section: 'التقارير', screen: 'تقرير العمولات', route: '/app/accounting/commissions-report', description: 'عمولات الموظفين', permission: 'accounting_reports.view' },
  { section: 'التقارير', screen: 'تقرير الخزائن', route: '/app/accounting/treasury-report', description: 'أرصدة وحركة الخزائن والبنوك', permission: 'accounting_reports.view' },

  { section: 'البيانات الأساسية', screen: 'المنتجات', route: '/app/master-data/products', description: 'إدارة المنتجات والمكوّنات', permission: 'products.view' },
  { section: 'البيانات الأساسية', screen: 'العملاء', route: '/app/master-data/customers', description: 'إدارة العملاء وكشوف حساباتهم', permission: 'customers.view' },
  { section: 'البيانات الأساسية', screen: 'الموردين', route: '/app/master-data/suppliers', description: 'إدارة الموردين وكشوف حساباتهم', permission: 'suppliers.view' },
  { section: 'البيانات الأساسية', screen: 'الموظفين', route: '/app/master-data/employees', description: 'إدارة الموظفين', permission: 'employees.view' },
  { section: 'البيانات الأساسية', screen: 'الوحدات/العلامات/التصنيفات', route: '/app/master-data/units', description: 'وحدات القياس والعلامات وتصنيفات المنتجات', permission: 'product_catalog.view' },

  { section: 'الإعدادات', screen: 'الشركة', route: '/app/settings/company', description: 'بيانات الشركة', permission: 'company.view' },
  { section: 'الإعدادات', screen: 'الفروع', route: '/app/settings/branches', description: 'إدارة الفروع', permission: 'branches.view' },
  { section: 'الإعدادات', screen: 'المخازن', route: '/app/settings/warehouses', description: 'إدارة المخازن', permission: 'warehouses.view' },
  { section: 'الإعدادات', screen: 'الخزائن', route: '/app/settings/treasuries', description: 'إدارة الخزائن', permission: 'treasuries.view' },
  { section: 'الإعدادات', screen: 'الحسابات البنكية', route: '/app/settings/bank-accounts', description: 'إدارة الحسابات البنكية', permission: 'bank_accounts.view' },
  { section: 'الإعدادات', screen: 'دليل الحسابات', route: '/app/settings/chart-of-accounts', description: 'شجرة الحسابات', permission: 'chart_of_accounts.view' },
  { section: 'الإعدادات', screen: 'إعدادات المحاسبة', route: '/app/settings/accounting-settings', description: 'الحسابات الافتراضية للنظام', permission: 'accounting_settings.view' },
  { section: 'الإعدادات', screen: 'المستخدمون', route: '/app/settings/users', description: 'إدارة المستخدمين', permission: 'users.view' },
  { section: 'الإعدادات', screen: 'الأدوار والصلاحيات', route: '/app/settings/roles', description: 'أدوار وصلاحيات المستخدمين', permission: 'roles.view' },
  { section: 'الإعدادات', screen: 'السنوات المالية', route: '/app/settings/fiscal-years', description: 'السنوات والفترات المحاسبية', permission: 'fiscal_years.view' },
];

/** How-to guidance for common workflows (routes only from NAV_MAP). */
const WORKFLOWS: Record<string, string> = {
  'فاتورة مبيعات': 'المبيعات ← فواتير المبيعات ← زر "فاتورة مبيعات جديدة": اختر العميل والفرع، أضف الأصناف (كل صنف من مخزنه)، ثم "بيع وتحصيل" (نقدي) أو "حفظ وإنشاء إذن تسليم" (آجل).',
  'فاتورة مشتريات': 'المشتريات ← فواتير المشتريات ← جديد: اختر المورد والمخزن وأضف الأصناف، ثم رحّل الفاتورة.',
  'سند قبض': 'المالية ← السندات ← سند قبض جديد: اختر العميل/الحساب وطريقة التحصيل (خزينة/بنك) والمبلغ.',
  'إضافة عميل': 'البيانات الأساسية ← العملاء ← جديد.',
  'إضافة مورد': 'البيانات الأساسية ← الموردين ← جديد.',
  'أمر تصنيع': 'التصنيع ← أوامر التصنيع: يُنشأ تلقائياً من فاتورة بها صنف تصنيع، أو يدوياً؛ حدّد المكوّنات (مخزن كل مكوّن) والرسوم، ثم "تنفيذ الإنتاج".',
};

/** Navigation & help tools (generic app guidance — no financial data). */
@Injectable()
export class NavigationAiTools {
  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_navigation_help',
        description:
          'أين توجد شاشة معيّنة في النظام وكيف تصل إليها. مرّر كلمة/موضوع للبحث (مثل "العملاء"، "تقرير المخزون"، "فاتورة مبيعات")، أو اتركه فارغاً لعرض كل الشاشات.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'اسم الشاشة/التقرير أو موضوع' } },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const q = optStr(args.query)?.toLowerCase();
          // Only surface screens the user can access.
          const visible = NAV_MAP.filter(
            (s) => !s.permission || ctx.isSuperAdmin || ctx.permissions.includes(s.permission),
          );
          const screens = q
            ? visible.filter(
                (s) =>
                  s.screen.toLowerCase().includes(q) ||
                  s.section.toLowerCase().includes(q) ||
                  s.description.toLowerCase().includes(q),
              )
            : visible;
          const workflowKey = q ? Object.keys(WORKFLOWS).find((k) => k.includes(q) || q.includes(k)) : undefined;
          return {
            success: true,
            presentation: 'navigation',
            data: {
              screens: screens.map((s) => ({ section: s.section, screen: s.screen, route: s.route, description: s.description })),
              workflow: workflowKey ? WORKFLOWS[workflowKey] : undefined,
            },
          };
        },
      },
      {
        name: 'get_module_help',
        description: 'شرح خطوات عملية شائعة (فاتورة مبيعات، فاتورة مشتريات، سند قبض، إضافة عميل/مورد، أمر تصنيع).',
        parameters: {
          type: 'object',
          properties: { topic: { type: 'string', description: 'اسم العملية' } },
          required: ['topic'],
          additionalProperties: false,
        },
        handler: async (args) => {
          const t = optStr(args.topic) ?? '';
          const key = Object.keys(WORKFLOWS).find((k) => k.includes(t) || t.includes(k));
          if (!key) {
            return { success: false, code: 'HELP_NOT_FOUND', message: 'لا تتوفر لديّ خطوات محفوظة لهذه العملية.' };
          }
          return { success: true, presentation: 'text', data: { topic: key, steps: WORKFLOWS[key] } };
        },
      },
    ];
  }
}
