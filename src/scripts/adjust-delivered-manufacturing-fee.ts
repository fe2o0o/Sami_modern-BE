/**
 * ONE-OFF ADJUSTMENT — change the manufacturing fee of an order that was already
 * PRODUCED and fully DELIVERED (the goods left stock, so the difference belongs
 * to cost of sales, not inventory).
 *
 * What it does (one transaction, nothing posted is edited or deleted):
 *   1. posts ONE adjustment journal entry for the difference:
 *        increase → DR cost of goods sold / CR factory (supplier control)
 *        decrease → DR factory / CR cost of goods sold
 *      (internal order without a factory → the manufacturing-fee account)
 *   2. adds the matching ADJUSTMENT row to the factory's supplier statement;
 *   3. updates the records so every report shows the new cost:
 *        manufacturing order  → manufacturingFee, totalCost
 *        delivery line        → lineCost, unitCostAtPost (+ delivery totalCost)
 *        stock movements      → the production receipt and the delivery issue
 *                               unit cost (in and out by the same amount, so the
 *                               stock value itself does not change).
 *
 * Refuses when: the order is not produced, not fully delivered, has a posted
 * sales return, the new fee is negative (or 0 for an external factory), or the
 * accounting period of the entry date is missing/closed.
 *
 * SAFE BY DEFAULT — dry run prints the plan and changes nothing:
 *   node dist/scripts/adjust-delivered-manufacturing-fee.js --order=MO-2026-000019 --invoice=SI-2026-000017 --fee=38500
 * Apply (after a full backup):
 *   node dist/scripts/adjust-delivered-manufacturing-fee.js --order=MO-2026-000019 --invoice=SI-2026-000017 --fee=38500 --apply --confirm=<DB_DATABASE>
 * Optional: --date=YYYY-MM-DD (entry date, default today; its period must be open),
 *           --invoice=SI-YYYY-NNNNNN (safety check: the order must belong to it).
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { ManufacturingOrder } from '../modules/manufacturing/entities/manufacturing-order.entity';
import { ManufacturingOrderStatus } from '../modules/manufacturing/enums/manufacturing.enum';
import { SalesDelivery } from '../modules/sales-delivery/entities/sales-delivery.entity';
import { SalesDeliveryItem } from '../modules/sales-delivery/entities/sales-delivery-item.entity';
import { SalesDeliveryStatus } from '../modules/sales-delivery/enums/sales-delivery.enum';
import { SalesReturn } from '../modules/sales-return/entities/sales-return.entity';
import { SalesReturnItem } from '../modules/sales-return/entities/sales-return-item.entity';
import { SalesReturnStatus } from '../modules/sales-return/enums/sales-return.enum';
import { Product } from '../modules/product/entities/product.entity';
import { applyEffectiveAccounts } from '../modules/product/product-accounts';
import { AccountingSetting } from '../modules/accounting-setting/entities/accounting-setting.entity';
import { AccountingPeriod } from '../modules/accounting-period/entities/accounting-period.entity';
import { StockMovement } from '../modules/stock/entities/stock-movement.entity';
import { StockDirection } from '../modules/stock/enums/stock.enum';
import { JournalEntryService } from '../modules/journal-entry/journal-entry.service';
import { JournalSourceType } from '../modules/journal-entry/enums/journal-entry.enum';
import { JournalLineInput } from '../modules/journal-entry/journal-entry.rules';
import { SupplierLedgerService } from '../modules/supplier/supplier-ledger.service';
import { SupplierTransactionType } from '../modules/supplier/enums/supplier-transaction.enum';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};
const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const apply = args.includes('--apply');
  const confirm = arg('confirm');
  const orderNumber = arg('order');
  const newFee = round2(Number(arg('fee')));
  const date = arg('date') ?? today();
  const invoiceNumber = arg('invoice');
  const dbName = process.env.DB_DATABASE;

  if (!orderNumber || !Number.isFinite(newFee)) {
    console.error('Usage: --order=MO-YYYY-NNNNNN --fee=<new total fee> [--date=YYYY-MM-DD] [--apply --confirm=<DB_DATABASE>]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    console.log(`Database: ${dbName}   Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    if (apply && confirm !== dbName) {
      console.error(`Refusing to apply: pass --confirm=${dbName} to confirm the target database.`);
      process.exitCode = 1;
      return;
    }
    const dataSource = app.get(DataSource);
    const journals = app.get(JournalEntryService);
    const supplierLedger = app.get(SupplierLedgerService);

    await dataSource.transaction(async (manager) => {
      // ── load + validate ──
      const order = await manager.findOne(ManufacturingOrder, { where: { orderNumber }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new Error(`Manufacturing order ${orderNumber} not found`);
      if (invoiceNumber && order.sourceNumber !== invoiceNumber) {
        throw new Error(`Order ${orderNumber} belongs to invoice ${order.sourceNumber ?? '—'}, not ${invoiceNumber}`);
      }
      if (![ManufacturingOrderStatus.PRODUCED, ManufacturingOrderStatus.DONE].includes(order.status) || !order.producedAt) {
        throw new Error(`Order ${orderNumber} is "${order.status}" — only a produced order can be adjusted this way`);
      }
      const oldFee = round2(Number(order.manufacturingFee) || 0);
      const diff = round2(newFee - oldFee);
      if (newFee < 0) throw new Error('The new fee cannot be negative');
      if (order.factorySupplierId && newFee <= 0) throw new Error('An external factory order cannot have a zero fee');
      if (Math.abs(diff) < 0.005) throw new Error(`Fee is already ${fmt(oldFee)} — nothing to adjust`);
      const qty = Number(order.quantity) || 0;
      if (qty <= 0) throw new Error('Order quantity is zero');

      // delivery lines of this order (posted, or a draft note with confirmed lines)
      const lines = await manager
        .getRepository(SalesDeliveryItem)
        .createQueryBuilder('di')
        .innerJoinAndSelect('di.salesDelivery', 'sd')
        .where('di.manufacturingOrderId = :id', { id: order.id })
        .andWhere('sd.status <> :rev', { rev: SalesDeliveryStatus.REVERSED })
        .andWhere('di.deliveredQuantity > 0')
        .getMany();
      const delivered = lines.reduce((s, l) => s + (Number(l.deliveredQuantity) || 0), 0);
      if (!lines.length) throw new Error(`Order ${orderNumber} has no delivered line — use the in-progress fee adjustment instead`);
      if (delivered + 1e-6 < qty) throw new Error(`Order ${orderNumber} is only partly delivered (${delivered} of ${qty}) — not handled by this script`);

      if (order.salesInvoiceItemId) {
        const returned = await manager
          .getRepository(SalesReturnItem)
          .createQueryBuilder('ri')
          .innerJoin(SalesReturn, 'sr', 'sr.id = ri.salesReturnId AND sr.deletedAt IS NULL')
          .where('ri.salesInvoiceItemId = :item', { item: order.salesInvoiceItemId })
          .andWhere('sr.status = :st', { st: SalesReturnStatus.POSTED })
          .getCount();
        if (returned) throw new Error(`The invoice line of ${orderNumber} has a posted sales return — not handled by this script`);
      }

      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new Error('Accounting settings are missing');
      const product = await manager.getRepository(Product).findOne({ where: { id: order.productId } });
      if (!product) throw new Error('Manufactured product not found');
      await applyEffectiveAccounts([product], manager);
      const cogsAcc = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId;
      if (!cogsAcc) throw new Error('Cost of goods sold account is not configured');
      const supplierId = order.factorySupplierId;
      const feeAcc = supplierId ? settings.supplierControlAccountId : settings.manufacturingFeeAccountId;
      if (!feeAcc) throw new Error(supplierId ? 'Supplier control account is not configured' : 'Internal manufacturing fee account is not configured');

      const period = await manager
        .getRepository(AccountingPeriod)
        .createQueryBuilder('p')
        .where('p.startDate <= :d AND p.endDate >= :d', { d: date })
        .getOne();
      if (!period) throw new Error(`No accounting period contains ${date}`);
      if (period.isClosed) throw new Error(`Accounting period of ${date} is closed`);

      const unitDiff = round4(diff / qty);
      const receipts = await manager.find(StockMovement, {
        where: { sourceType: JournalSourceType.MANUFACTURING, sourceId: order.id, productId: order.productId, direction: StockDirection.IN },
      });
      const issues: StockMovement[] = [];
      for (const l of lines) {
        issues.push(
          ...(await manager.find(StockMovement, {
            where: { sourceType: JournalSourceType.SALES_DELIVERY, sourceId: l.salesDeliveryId, productId: order.productId, direction: StockDirection.OUT },
          })),
        );
      }

      // ── plan ──
      const productName = order.productName ?? product.name;
      const up = diff > 0;
      const amount = Math.abs(diff);
      const description =
        `تسوية رسوم تصنيع بعد التسليم — ${productName} — أمر تصنيع ${orderNumber}: ` +
        `من ${oldFee.toFixed(2)} إلى ${newFee.toFixed(2)} (${up ? 'زيادة' : 'تخفيض'} ${amount.toFixed(2)})` +
        ` — العميل: ${order.customerName ?? '—'} — فاتورة: ${order.sourceNumber ?? '—'}`;
      const costLine = `${up ? 'زيادة' : 'تخفيض'} تكلفة ${productName} المُسلَّم (تكلفة البضاعة المباعة) — أمر تصنيع ${orderNumber}`;
      const feeLine = supplierId
        ? `${up ? 'زيادة' : 'تخفيض'} رسوم تصنيع ${productName} المستحقة للمصنع — أمر تصنيع ${orderNumber}`
        : `${up ? 'زيادة' : 'تخفيض'} رسوم تصنيع داخلية — ${productName} — أمر تصنيع ${orderNumber}`;

      console.log(`\nOrder      : ${orderNumber} — ${productName} × ${qty} (${order.status})`);
      console.log(`Customer   : ${order.customerName ?? '—'}   Invoice: ${order.sourceNumber ?? '—'}`);
      console.log(`Factory    : ${order.factorySupplierName ?? (supplierId ? supplierId : 'internal (no factory)')}`);
      console.log(`Fee        : ${fmt(oldFee)} → ${fmt(newFee)}   (${up ? '+' : '−'}${fmt(amount)})`);
      console.log(`Total cost : ${fmt(Number(order.totalCost) || 0)} → ${fmt(round2((Number(order.totalCost) || 0) + diff))}`);
      console.log(`Entry date : ${date}`);
      console.log('Journal    :');
      console.log(`  ${up ? 'DR' : 'CR'} cost of goods sold  ${fmt(amount)}`);
      console.log(`  ${up ? 'CR' : 'DR'} ${supplierId ? 'factory (supplier)' : 'manufacturing fee account'}  ${fmt(amount)}`);
      console.log(`  "${description}"`);
      for (const l of lines) {
        console.log(`Delivery   : ${l.salesDelivery.deliveryNumber ?? l.salesDeliveryId} line cost ${fmt(Number(l.lineCost) || 0)} → ${fmt(round2((Number(l.lineCost) || 0) + round2(diff * (Number(l.deliveredQuantity) / qty))))}`);
      }
      console.log(`Stock moves: ${receipts.length} production receipt(s), ${issues.length} delivery issue(s) — unit cost ${unitDiff >= 0 ? '+' : ''}${unitDiff}`);

      if (!apply) {
        console.log('\nDRY RUN — nothing changed. Re-run with --apply --confirm=<DB_DATABASE> to apply.');
        return;
      }

      // ── apply ──
      const lineInputs: JournalLineInput[] = up
        ? [
            { accountId: cogsAcc, debit: amount, credit: 0, productId: order.productId, description: costLine },
            { accountId: feeAcc, debit: 0, credit: amount, supplierId: supplierId ?? undefined, description: feeLine },
          ]
        : [
            { accountId: feeAcc, debit: amount, credit: 0, supplierId: supplierId ?? undefined, description: feeLine },
            { accountId: cogsAcc, debit: 0, credit: amount, productId: order.productId, description: costLine },
          ];
      const je = await journals.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.MANUFACTURING,
          sourceId: order.id,
          sourceNumber: order.orderNumber,
          entryDate: date,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: order.branchId,
          description,
          lines: lineInputs,
          actorId: null,
        },
        manager,
      );
      if (supplierId) {
        await supplierLedger.record(
          {
            supplierId,
            transactionDate: date,
            type: SupplierTransactionType.ADJUSTMENT,
            sourceType: JournalSourceType.MANUFACTURING,
            sourceId: order.id,
            sourceNumber: order.orderNumber,
            debit: up ? 0 : amount,
            credit: up ? amount : 0,
            description,
            actorId: null,
          },
          manager,
        );
      }

      order.manufacturingFee = newFee;
      order.totalCost = round2((Number(order.totalCost) || 0) + diff);
      order.notes = [order.notes, `${description} — قيد ${je.entryNumber ?? je.id}`].filter(Boolean).join(' — ');
      await manager.getRepository(ManufacturingOrder).save(order);

      const touchedDeliveries = new Set<string>();
      for (const l of lines) {
        const share = round2(diff * (Number(l.deliveredQuantity) / qty));
        l.lineCost = round2((Number(l.lineCost) || 0) + share);
        l.unitCostAtPost = round2(l.lineCost / (Number(l.deliveredQuantity) || 1));
        await manager.getRepository(SalesDeliveryItem).save(l);
        touchedDeliveries.add(l.salesDeliveryId);
      }
      for (const id of touchedDeliveries) {
        const all = await manager.find(SalesDeliveryItem, { where: { salesDeliveryId: id } });
        await manager.update(SalesDelivery, { id }, { totalCost: round2(all.reduce((s, i) => s + (Number(i.lineCost) || 0), 0)) });
      }
      for (const m of [...receipts, ...issues]) {
        m.unitCost = round4((Number(m.unitCost) || 0) + unitDiff);
        await manager.getRepository(StockMovement).save(m);
      }

      console.log(`\nAPPLIED: journal ${je.entryNumber ?? je.id}, supplier statement ${supplierId ? 'updated' : 'n/a'}, order + ${lines.length} delivery line(s) + ${receipts.length + issues.length} stock movement(s) updated.`);
    });
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('FAILED (nothing changed — transaction rolled back):', e instanceof Error ? e.message : e);
  process.exit(1);
});
