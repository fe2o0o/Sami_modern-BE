import { Injectable } from '@nestjs/common';
import { LookupsService } from '../../lookups/lookups.service';
import { AiToolDefinition } from '../types/ai.types';
import { optUuid } from './tool-helpers';

/**
 * Reference tools: small entity lists/counts (branches, warehouses) used to
 * answer questions like "كام فرع عندي؟" / "إيه المخازن؟". Read-only, and every
 * list is filtered to the caller's branch scope.
 */
@Injectable()
export class ReferenceAiTools {
  constructor(private readonly lookups: LookupsService) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_branches',
        description:
          'قائمة الفروع المتاحة للمستخدم وعددها. استخدمها للإجابة عن أسئلة مثل «كام فرع عندي؟» أو «إيه الفروع الموجودة؟».',
        permission: 'branches.view',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        handler: async (_args, ctx) => {
          let branches = await this.lookups.branches();
          if (ctx.branchScope !== null) {
            const allowed = new Set(ctx.branchScope);
            branches = branches.filter((b) => allowed.has(b.id));
          }
          return {
            success: true,
            presentation: 'table',
            data: { title: 'الفروع', count: branches.length, branches },
          };
        },
      },
      {
        name: 'get_warehouses',
        description:
          'قائمة المخازن (اختيارياً لفرع محدد) وعددها. للإجابة عن «كام مخزن؟» أو «مخازن فرع كذا».',
        permission: 'warehouses.view',
        parameters: {
          type: 'object',
          properties: {
            branchId: { type: 'string', description: 'الفرع (uuid) — اختياري' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const branchId = optUuid(args.branchId, 'branchId');
          let warehouses = await this.lookups.warehouses(branchId);
          if (ctx.branchScope !== null) {
            const allowed = new Set(ctx.branchScope);
            // A null branchId = shared warehouse available to all branches.
            warehouses = warehouses.filter(
              (w) => w.branchId === null || allowed.has(w.branchId),
            );
          }
          return {
            success: true,
            presentation: 'table',
            data: { title: 'المخازن', count: warehouses.length, warehouses },
          };
        },
      },
    ];
  }
}
