import { JournalLineInput } from './journal-entry.rules';
import { round2 } from './journal-entry.rules';

type LineDims = Pick<JournalLineInput, 'branchId' | 'customerId' | 'supplierId' | 'warehouseId' | 'productId'>;

/**
 * Accumulates document postings into balanced journal lines. Lines are keyed by
 * account + narration + analytic dimensions, so two hits on the same account
 * with the same story merge into one line while different stories (or
 * different customers/warehouses) stay separate — the ledger then reads like
 * the document: "مديونية العميل X — فاتورة 12" instead of a bare account.
 */
export class JournalLineBuilder {
  private readonly acc = new Map<string, JournalLineInput>();

  add(accountId: string, debit: number, credit: number, description: string, dims: LineDims = {}): this {
    const d: LineDims = {
      branchId: dims.branchId ?? null,
      customerId: dims.customerId ?? null,
      supplierId: dims.supplierId ?? null,
      warehouseId: dims.warehouseId ?? null,
      productId: dims.productId ?? null,
    };
    const key = [accountId, description, d.branchId, d.customerId, d.supplierId, d.warehouseId, d.productId].join('|');
    const e = this.acc.get(key) ?? { accountId, debit: 0, credit: 0, description, ...d };
    e.debit = round2(e.debit + (debit || 0));
    e.credit = round2(e.credit + (credit || 0));
    this.acc.set(key, e);
    return this;
  }

  /** Net each line to one side and drop the empty ones. */
  build(): JournalLineInput[] {
    return [...this.acc.values()]
      .map((e) => {
        const net = round2(e.debit - e.credit);
        return net >= 0 ? { ...e, debit: net, credit: 0 } : { ...e, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
  }
}
