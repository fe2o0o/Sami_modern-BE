import { Injectable } from '@nestjs/common';
import { VoucherService } from '../../voucher/voucher.service';
import { VoucherQueryDto } from '../../voucher/dto/voucher-query.dto';
import { AiToolDefinition } from '../types/ai.types';
import { CURRENCY, dateProp, listQuery, normalizeDate, optStr, optUuid } from './tool-helpers';

/** Receipt / payment voucher tools. Gated by `vouchers.view`. */
@Injectable()
export class VoucherAiTools {
  constructor(private readonly vouchers: VoucherService) {}

  defs(): AiToolDefinition[] {
    return [
      {
        name: 'get_vouchers',
        description:
          'قائمة سندات القبض/الصرف مع فلاتر: النوع (receipt=قبض / payment=صرف)، الطرف (عميل/مورد)، طريقة الدفع (treasury/bank)، الحالة، والفترة. مرقّمة.',
        permission: 'vouchers.view',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'receipt (قبض) أو payment (صرف)' },
            partyId: { type: 'string', description: 'معرّف العميل/المورد (uuid)' },
            paymentMethod: { type: 'string', description: 'treasury أو bank' },
            status: { type: 'string' },
            dateFrom: dateProp('بداية الفترة'),
            dateTo: dateProp('نهاية الفترة'),
            search: { type: 'string', description: 'رقم السند' },
            page: { type: 'number' },
            perPage: { type: 'number' },
          },
          additionalProperties: false,
        },
        handler: async (args, ctx) => {
          const query = listQuery(Number(args.page) || 1, Math.min(50, Number(args.perPage) || 15), {
            type: optStr(args.type),
            partyId: optUuid(args.partyId, 'partyId'),
            paymentMethod: optStr(args.paymentMethod),
            status: optStr(args.status),
            dateFrom: normalizeDate(args.dateFrom, 'dateFrom'),
            dateTo: normalizeDate(args.dateTo, 'dateTo'),
            search: optStr(args.search),
          }) as unknown as VoucherQueryDto;
          const res = await this.vouchers.findAll(query, ctx.branchScope);
          return {
            success: true,
            presentation: 'table',
            data: { title: 'السندات', currency: CURRENCY, total: res.meta.totalItems, page: res.meta.currentPage, vouchers: res.items },
          };
        },
      },
    ];
  }
}
