import { Injectable } from '@nestjs/common';
import { ProductCategoryService, CategoryTreeNode } from '../../product-category/product-category.service';
import { LookupsService } from '../../lookups/lookups.service';
import { AiToolDefinition } from '../types/ai.types';
import { optStr } from './tool-helpers';

type AccountSlot = 'inventoryAccountId' | 'cogsAccountId' | 'salesAccountId';
const SLOTS: AccountSlot[] = ['inventoryAccountId', 'cogsAccountId', 'salesAccountId'];

/** Product catalog tools. Permissions mirror product-category.controller.ts. */
@Injectable()
export class CatalogAiTools {
  constructor(
    private readonly categories: ProductCategoryService,
    private readonly lookups: LookupsService,
  ) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_product_categories',
        description:
          'شجرة تصنيفات المنتجات (الكود، الاسم، المستوى، التصنيف الأب، نشط) مع حسابات الترحيل لكل تصنيف: حساب المخزون، حساب تكلفة المبيعات، حساب الإيراد/المبيعات. ' +
          'الحساب يُورَّث من التصنيف الأب للأبناء ما لم يحدد الابن حسابه؛ وإن لم يُحدَّد في أي مستوى تُستخدم الحسابات الافتراضية من إعدادات المحاسبة. ' +
          'كل عمود حساب يعرض الحساب الفعلي ومصدره (محدد على التصنيف / موروث من الأب / الافتراضي).',
        permission: 'product_catalog.view',
        parameters: {
          type: 'object',
          properties: { search: { type: 'string', description: 'اسم أو كود التصنيف (اختياري)' } },
          additionalProperties: false,
        },
        handler: async (args) => {
          const [tree, accounts] = await Promise.all([this.categories.tree(), this.lookups.postingAccounts()]);
          const accName = new Map(accounts.map((a) => [a.id, a.name]));
          const rows: Record<string, unknown>[] = [];
          // Walk the tree top-down carrying the nearest ancestor's account per slot.
          const walk = (
            nodes: CategoryTreeNode[],
            parentName: string | null,
            inherited: Record<AccountSlot, { id: string; from: string } | null>,
          ) => {
            for (const n of nodes) {
              const effective = { ...inherited };
              const row: Record<string, unknown> = {
                code: n.code,
                name: n.name,
                level: n.level,
                parentName,
                isActive: n.isActive,
              };
              for (const slot of SLOTS) {
                const own = n[slot];
                if (own) effective[slot] = { id: own, from: n.name };
                // One column per slot: the effective account + where it comes from.
                const eff = effective[slot];
                const key = slot.replace('Id', ''); // inventoryAccount / cogsAccount / salesAccount
                row[key] = own
                  ? `${accName.get(own) ?? own} (محدد على التصنيف)`
                  : eff
                    ? `${accName.get(eff.id) ?? eff.id} (موروث من «${eff.from}»)`
                    : 'الافتراضي من إعدادات المحاسبة';
              }
              rows.push(row);
              walk(n.children ?? [], n.name, effective);
            }
          };
          walk(tree, null, { inventoryAccountId: null, cogsAccountId: null, salesAccountId: null });
          const q = optStr(args.search)?.toLowerCase();
          const categories = q
            ? rows.filter((r) => String(r.name).toLowerCase().includes(q) || String(r.code).toLowerCase().includes(q))
            : rows;
          return {
            success: true,
            presentation: 'table',
            data: { title: 'تصنيفات المنتجات', count: categories.length, categories: categories.slice(0, 100) },
          };
        },
      },
    ];
  }
}
