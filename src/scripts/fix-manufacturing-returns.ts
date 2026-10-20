/**
 * ONE-OFF FIX — posted sales returns of DELIVERED manufactured items that were
 * posted before the fix (manufacturing lines never went back into stock and their
 * cost of sales was never reversed).
 *
 * For every affected return line it:
 *   1. puts the delivered part back INTO stock (warehouse it was delivered from,
 *      at its delivery unit cost) — stock movement «مردود مبيعات»;
 *   2. posts ONE correction journal per return (today, open period):
 *        DR finished-goods inventory / CR cost of goods sold
 *   3. records restockedQuantity / warehouse / cost on the return line, so a later
 *      reversal of that return takes it back out (and reverses the correction).
 *
 * Only the DELIVERED part is restocked: quantity − cogsAccrualReleasedQty (the
 * undelivered part was already handled by releasing the invoice's cost accrual),
 * capped by what was delivered minus what other returns already restocked.
 *
 * SAFE BY DEFAULT — dry run prints the plan and changes nothing. To apply:
 *   node dist/scripts/fix-manufacturing-returns.js --apply --confirm=<DB_DATABASE>
 * Everything runs in ONE transaction (all or nothing). Take a full backup first:
 *   mysqldump --no-tablespaces -u <user> -p <DB_DATABASE> > backup-before-mfg-returns.sql
 */
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager, In } from 'typeorm';
import { AppModule } from '../app.module';
import { SalesReturnItem } from '../modules/sales-return/entities/sales-return-item.entity';
import { SalesReturn } from '../modules/sales-return/entities/sales-return.entity';
import { SalesReturnStatus } from '../modules/sales-return/enums/sales-return.enum';
import { SalesLineType } from '../modules/sales-invoice/enums/sales-invoice.enum';
import { SalesDeliveryItem } from '../modules/sales-delivery/entities/sales-delivery-item.entity';
import { SalesDelivery } from '../modules/sales-delivery/entities/sales-delivery.entity';
import { Product } from '../modules/product/entities/product.entity';
import { ProductType } from '../modules/product/enums/product-type.enum';
import { applyEffectiveAccounts } from '../modules/product/product-accounts';
import { AccountingSetting } from '../modules/accounting-setting/entities/accounting-setting.entity';
import { AccountingPeriod } from '../modules/accounting-period/entities/accounting-period.entity';
import { Warehouse } from '../modules/warehouse/entities/warehouse.entity';
import { StockService } from '../modules/stock/stock.service';
import { StockMovementType } from '../modules/stock/enums/stock.enum';
import { JournalEntryService } from '../modules/journal-entry/journal-entry.service';
import { JournalSourceType } from '../modules/journal-entry/enums/journal-entry.enum';
import { JournalLineInput } from '../modules/journal-entry/journal-entry.rules';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

interface PlanLine {
  item: SalesReturnItem;
  ret: SalesReturn;
  product: Product;
  restockQty: number;
  unitCost: number;
  warehouseId: string;
  warehouseName: string;
  inventoryAccountId: string;
  cogsAccountId: string;
}

async function deliveredInfo(manager: EntityManager, invoiceItemId: string): Promise<{ qty: number; cost: number; warehouseId: string | null }> {
  const r = await manager
    .getRepository(SalesDeliveryItem)
    .createQueryBuilder('di')
    .innerJoin(SalesDelivery, 'd', 'd.id = di.salesDeliveryId')
    .select(
      `COALESCE(SUM(CASE WHEN d.status = 'posted' THEN di.quantity WHEN d.status = 'draft' THEN COALESCE(di.deliveredQuantity, 0) ELSE 0 END), 0)`,
      'qty',
    )
    .addSelect(`COALESCE(SUM(CASE WHEN d.status IN ('posted','draft') THEN di.lineCost ELSE 0 END), 0)`, 'cost')
    .addSelect(`MAX(CASE WHEN d.status <> 'reversed' THEN di.warehouseId END)`, 'warehouseId')
    .where('di.salesInvoiceItemId = :id', { id: invoiceItemId })
    .getRawOne<{ qty: string; cost: string; warehouseId: string | null }>();
  return { qty: Number(r?.qty ?? 0), cost: Number(r?.cost ?? 0), warehouseId: r?.warehouseId ?? null };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirm = args.find((a) => a.startsWith('--confirm='))?.split('=')[1];
  const dbName = process.env.DB_DATABASE;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  const stock = app.get(StockService);
  const journals = app.get(JournalEntryService);
  console.log(`DB: ${dbName} · mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  if (apply && confirm !== dbName) {
    console.error(`Refusing to apply: pass --confirm=${dbName} to confirm the target database.`);
    await app.close();
    process.exit(1);
  }

  try {
    await dataSource.transaction(async (manager) => {
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new Error('Accounting settings not found');

      const items = await manager.getRepository(SalesReturnItem).find({
        where: { lineType: SalesLineType.MANUFACTURING, restockedQuantity: 0, salesReturn: { status: SalesReturnStatus.POSTED } },
        relations: { salesReturn: true },
        order: { salesReturn: { returnDate: 'ASC' }, lineNumber: 'ASC' },
      });
      const productIds = [...new Set(items.map((i) => i.productId))];
      const products: Product[] = productIds.length ? await manager.getRepository(Product).findBy({ id: In(productIds) }) : [];
      await applyEffectiveAccounts(products, manager);
      const productById = new Map<string, Product>(products.map((p) => [p.id, p]));
      const warehouses = new Map((await manager.getRepository(Warehouse).find()).map((w) => [w.id, w.name]));

      // Already restocked per invoice line (by fixed/new returns), incl. this run.
      const restockedByInvoiceItem = new Map<string, number>();
      const already = await manager
        .getRepository(SalesReturnItem)
        .createQueryBuilder('ri')
        .innerJoin('ri.salesReturn', 'r')
        .select('ri.salesInvoiceItemId', 'id')
        .addSelect('SUM(ri.restockedQuantity)', 'qty')
        .where(`r.status = 'posted' AND ri.lineType = 'manufacturing' AND ri.restockedQuantity > 0`)
        .groupBy('ri.salesInvoiceItemId')
        .getRawMany<{ id: string; qty: string }>();
      for (const a of already) restockedByInvoiceItem.set(a.id, Number(a.qty));

      const plan: PlanLine[] = [];
      const skipped: string[] = [];
      for (const item of items) {
        const ret = item.salesReturn;
        const product = productById.get(item.productId);
        const label = `${ret.returnNumber} · ${item.productName}`;
        if (!product?.trackInventory) { skipped.push(`${label}: product is not stock-tracked`); continue; }
        if (!item.salesInvoiceItemId) { skipped.push(`${label}: no invoice line`); continue; }
        const del = await deliveredInfo(manager, item.salesInvoiceItemId);
        if (del.qty <= 0) { skipped.push(`${label}: nothing was delivered (undelivered part already handled)`); continue; }
        const deliveredPart = round3(Math.max(0, Number(item.quantity) - Number(item.cogsAccrualReleasedQty || 0)));
        const room = round3(del.qty - (restockedByInvoiceItem.get(item.salesInvoiceItemId) ?? 0));
        const restockQty = round3(Math.min(deliveredPart, room));
        if (restockQty <= 0) { skipped.push(`${label}: nothing left to restock`); continue; }
        const warehouseId = item.warehouseId ?? del.warehouseId;
        if (!warehouseId) { skipped.push(`${label}: delivery warehouse unknown — fix manually`); continue; }
        const unitCost = round2(del.cost / del.qty);
        const inventoryAccountId =
          product.inventoryAccountId ??
          (product.productType === ProductType.RAW_MATERIAL ? settings.rawMaterialInventoryAccountId : settings.finishedGoodsInventoryAccountId);
        const cogsAccountId = product.cogsAccountId ?? settings.costOfGoodsSoldAccountId;
        if (!inventoryAccountId || !cogsAccountId) { skipped.push(`${label}: inventory / COGS account not configured`); continue; }
        restockedByInvoiceItem.set(item.salesInvoiceItemId, (restockedByInvoiceItem.get(item.salesInvoiceItemId) ?? 0) + restockQty);
        plan.push({ item, ret, product, restockQty, unitCost, warehouseId, warehouseName: warehouses.get(warehouseId) ?? warehouseId, inventoryAccountId, cogsAccountId });
      }

      console.log(`\nAffected return lines: ${plan.length}`);
      let totalCost = 0;
      for (const p of plan) {
        const cost = round2(p.restockQty * p.unitCost);
        totalCost += cost;
        console.log(
          `  ${p.ret.returnNumber} (invoice ${p.ret.invoiceNumber ?? '—'}, returned ${p.ret.returnDate}) · ${p.item.productName}: ` +
            `restock ${p.restockQty} of ${p.item.quantity} → «${p.warehouseName}» @ ${p.unitCost} = ${cost}`,
        );
      }
      console.log(`  Total: DR inventory / CR COGS ${round2(totalCost)}`);
      if (skipped.length) {
        console.log(`\nSkipped (${skipped.length}):`);
        for (const s of skipped) console.log(`  - ${s}`);
      }
      if (!apply) {
        console.log('\nDRY RUN — nothing changed. Re-run with --apply --confirm=<DB_DATABASE> to apply.');
        return;
      }
      if (!plan.length) {
        console.log('\nNothing to fix.');
        return;
      }

      const date = today();
      const period = await manager
        .getRepository(AccountingPeriod)
        .createQueryBuilder('p')
        .where('p.startDate <= :d AND p.endDate >= :d', { d: date })
        .getOne();
      if (!period) throw new Error(`No accounting period contains ${date}`);
      if (period.isClosed) throw new Error(`Accounting period of ${date} is closed`);

      const byReturn = new Map<string, PlanLine[]>();
      for (const p of plan) byReturn.set(p.ret.id, [...(byReturn.get(p.ret.id) ?? []), p]);

      for (const [, lines] of byReturn) {
        const ret = lines[0].ret;
        await stock.receive(
          lines.map((p) => ({ warehouseId: p.warehouseId, productId: p.item.productId, quantity: p.restockQty, unitCost: p.unitCost })),
          manager,
          {
            movementType: StockMovementType.SALE_RETURN,
            sourceType: JournalSourceType.SALES_RETURN,
            sourceId: ret.id,
            sourceNumber: ret.returnNumber,
            movementDate: date,
            actorId: null,
          },
        );
        const jl: JournalLineInput[] = [];
        for (const p of lines) {
          const cost = round2(p.restockQty * p.unitCost);
          if (cost <= 0) continue;
          const what = `صنف مُصنّع ${p.item.productName ?? ''} (${p.restockQty})`;
          jl.push({ accountId: p.inventoryAccountId, debit: cost, credit: 0, productId: p.item.productId, warehouseId: p.warehouseId, description: `تصحيح: إعادة بضاعة مرتجعة للمخزون — ${what} — مردود مبيعات ${ret.returnNumber}` });
          jl.push({ accountId: p.cogsAccountId, debit: 0, credit: cost, productId: p.item.productId, description: `تصحيح: عكس تكلفة البضاعة المباعة — ${what} — مردود مبيعات ${ret.returnNumber}` });
        }
        if (jl.length) {
          const je = await journals.createSystemJournalEntry(
            {
              sourceType: JournalSourceType.SALES_RETURN,
              sourceId: ret.id,
              sourceNumber: ret.returnNumber,
              entryDate: date,
              fiscalYearId: period.fiscalYearId,
              accountingPeriodId: period.id,
              branchId: ret.branchId,
              description: `تصحيح مردود مبيعات ${ret.returnNumber} — إعادة الصنف المُصنّع للمخزون وعكس تكلفته — فاتورة ${ret.invoiceNumber ?? ''}`,
              lines: jl,
              actorId: null,
            },
            manager,
          );
          console.log(`  posted ${je.entryNumber ?? je.id} for ${ret.returnNumber}`);
        }
        for (const p of lines) {
          p.item.restockedQuantity = p.restockQty;
          p.item.warehouseId = p.warehouseId;
          p.item.costAtPost = p.unitCost;
          await manager.getRepository(SalesReturnItem).save(p.item);
        }
      }
      console.log(`\nAPPLIED: ${plan.length} line(s) in ${byReturn.size} return(s).`);
    });
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('FAILED (nothing changed — transaction rolled back):', e instanceof Error ? e.message : e);
  process.exit(1);
});
