#!/usr/bin/env node
/* eslint-disable */
/**
 * ONE-OFF MAINTENANCE (requested by the owner) — wipe ALL sales invoices, delivery
 * orders/notes, sales returns and manufacturing orders so they can be re-entered
 * from scratch, numbering restarting at 1.
 *
 * Owner's conditions:
 *   - TREASURIES / BANKS MUST NOT CHANGE. Cash invoices/returns already moved cash;
 *     that cash leg is KEPT: each such journal entry is converted in place into a
 *     «نقدي محفوظ — مستند ملغى» entry (cash line unchanged, the rest replaced by one
 *     line on the customer control account), its treasury/bank rows are kept, and
 *     the customer statement gets one matching adjustment row.
 *   - Customer balances may go negative until the invoices are re-entered.
 *
 * Removes (hard delete, incl. soft-deleted rows):
 *   sales_invoices (+items, item components, commissions), sales_deliveries (+items),
 *   sales_returns (+items), manufacturing_orders (+components); every other journal
 *   entry (+lines) with source_type sales_invoice / sales_delivery / sales_return /
 *   manufacturing; customer & supplier subledger rows of those sources; stock
 *   movements of those sources; document sequences SI / DN / SR / MO.
 * Then rebuilds warehouse_stock (quantity + weighted-average cost) by replaying the
 * remaining movements (opening, purchases, purchase returns, adjustments, transfers)
 * in date order and clears all reservations.
 *
 * KEPT: customers, suppliers, products, purchases, vouchers, opening balances,
 * adjustments, transfers, manual journal entries, settings, treasury/bank balances.
 *
 *   node scripts/reset-sales-documents.js                       → DRY RUN (changes nothing)
 *   node scripts/reset-sales-documents.js --apply --confirm=<DB_DATABASE>
 * TAKE A FULL BACKUP FIRST. Everything runs in ONE transaction (all-or-nothing).
 */
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const SOURCES = ['sales_invoice', 'sales_delivery', 'sales_return', 'manufacturing'];
const CASH_SOURCES = ['sales_invoice', 'sales_return'];
const SEQ_PREFIXES = ['SI', 'DN', 'SR', 'MO'];
const DOC_TABLES = [
  'sales_invoice_item_components', 'sales_invoice_commissions', 'sales_invoice_items',
  'sales_delivery_items', 'sales_return_items', 'manufacturing_order_components',
  'sales_deliveries', 'sales_returns', 'manufacturing_orders', 'sales_invoices',
];

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const confirm = (args.find((a) => a.startsWith('--confirm=')) || '').split('=')[1];
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const r3 = (v) => Math.round((v + Number.EPSILON) * 1000) / 1000;
const ph = (arr) => arr.map(() => '?').join(',');

async function main() {
  const db = process.env.DB_DATABASE;
  if (APPLY && confirm !== db) {
    console.error(`Refusing to apply: pass --confirm=${db} to confirm the target database.`);
    process.exit(2);
  }
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: db, dateStrings: true,
  });
  const q = async (sql, p = []) => (await c.query(sql, p))[0];
  const n = async (sql, p = []) => Number((await q(sql, p))[0].n);
  console.log(`\nDatabase: ${db}   Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no changes)'}\n`);

  // ── cash legs to preserve (treasury/bank must not change) ──
  const settings = (await q('SELECT customer_control_account_id cc FROM accounting_settings LIMIT 1'))[0];
  const cashAccounts = new Set([
    ...(await q('SELECT account_id a FROM treasuries')).map((r) => r.a),
    ...(await q('SELECT account_id a FROM bank_accounts')).map((r) => r.a),
  ]);
  const cashJes = [];
  const candidates = await q(
    `SELECT je.id, je.source_type st, je.source_id sid, je.source_number sno, je.entry_number eno FROM journal_entries je WHERE je.source_type IN (${ph(CASH_SOURCES)})`,
    CASH_SOURCES,
  );
  for (const je of candidates) {
    const lines = await q('SELECT id, account_id a, debit d, credit c FROM journal_entry_lines WHERE journal_entry_id = ?', [je.id]);
    const cashLines = lines.filter((l) => cashAccounts.has(l.a));
    if (!cashLines.length) continue;
    const net = r2(cashLines.reduce((s, l) => s + Number(l.d) - Number(l.c), 0)); // >0 cash in
    if (Math.abs(net) < 0.005) continue;
    const doc = je.st === 'sales_invoice'
      ? (await q('SELECT customer_id cu, invoice_number no FROM sales_invoices WHERE id = ?', [je.sid]))[0]
      : (await q('SELECT customer_id cu, return_number no FROM sales_returns WHERE id = ?', [je.sid]))[0];
    if (!doc) continue;
    cashJes.push({ ...je, net, cashLineIds: cashLines.map((l) => l.id), customerId: doc.cu, docNo: doc.no ?? je.sno ?? '' });
  }
  if (cashJes.length && !settings?.cc) throw new Error('customer control account is not set in accounting settings — cannot preserve cash legs');

  // ── what will be removed ──
  const counts = {};
  for (const t of DOC_TABLES) counts[t] = await n(`SELECT COUNT(*) n FROM \`${t}\``);
  const keepJeIds = cashJes.map((j) => j.id);
  const delJeWhere = `source_type IN (${ph(SOURCES)})${keepJeIds.length ? ` AND id NOT IN (${ph(keepJeIds)})` : ''}`;
  const delJeParams = [...SOURCES, ...keepJeIds];
  counts.journal_entries = await n(`SELECT COUNT(*) n FROM journal_entries WHERE ${delJeWhere}`, delJeParams);
  counts.journal_entry_lines = await n(`SELECT COUNT(*) n FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE ${delJeWhere})`, delJeParams);
  counts.customer_transactions = await n(`SELECT COUNT(*) n FROM customer_transactions WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
  counts.supplier_transactions = await n(`SELECT COUNT(*) n FROM supplier_transactions WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
  counts.stock_movements = await n(`SELECT COUNT(*) n FROM stock_movements WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
  counts.document_sequences = await n(`SELECT COUNT(*) n FROM document_sequences WHERE ${SEQ_PREFIXES.map(() => '`key` LIKE ?').join(' OR ')}`, SEQ_PREFIXES.map((p) => `${p}:%`));
  console.log('Rows to delete:');
  console.table(Object.entries(counts).map(([table, rows]) => ({ table, rows })));
  console.log(`Cash entries KEPT (treasury/bank unchanged, converted to «نقدي محفوظ»): ${cashJes.length}` +
    (cashJes.length ? `  — total net cash ${r2(cashJes.reduce((s, j) => s + j.net, 0))}` : ''));
  const tre0 = await q('SELECT treasury_id t, ROUND(SUM(debit - credit), 2) b FROM treasury_transactions WHERE deleted_at IS NULL GROUP BY treasury_id');
  const bnk0 = await q('SELECT bank_account_id t, ROUND(SUM(debit - credit), 2) b FROM bank_transactions WHERE deleted_at IS NULL GROUP BY bank_account_id');

  // ── stock rebuild preview ──
  const movements = await q(
    `SELECT warehouse_id w, product_id p, direction d, quantity qn, unit_cost u FROM stock_movements
      WHERE deleted_at IS NULL AND (source_type IS NULL OR source_type NOT IN (${ph(SOURCES)}))
      ORDER BY movement_date, created_at, id`, SOURCES);
  const state = new Map();
  for (const m of movements) {
    const k = `${m.w}|${m.p}`;
    const s = state.get(k) || { w: m.w, p: m.p, q: 0, avg: 0 };
    const qty = Number(m.qn) || 0, cost = Number(m.u) || 0;
    if (m.d === 'in') {
      const nq = s.q + qty;
      s.avg = nq > 0 && s.q > 0 ? (s.q * s.avg + qty * cost) / nq : cost;
      s.q = nq;
    } else s.q -= qty;
    state.set(k, s);
  }
  const current = await q(
    `SELECT ws.id, ws.warehouse_id w, ws.product_id p, ws.quantity qn, ws.reserved_quantity rq, ws.avg_cost a, pr.name pn, wh.name wn
       FROM warehouse_stock ws LEFT JOIN products pr ON pr.id = ws.product_id LEFT JOIN warehouses wh ON wh.id = ws.warehouse_id`);
  const diffs = []; const seen = new Set();
  for (const r of current) {
    const k = `${r.w}|${r.p}`; seen.add(k);
    const s = state.get(k);
    const nq = r3(s ? s.q : 0), na = s ? r2(s.avg) : r2(Number(r.a));
    if (Math.abs(nq - Number(r.qn)) > 1e-6 || Math.abs(na - Number(r.a)) > 0.004 || Number(r.rq) > 0) {
      diffs.push({ id: r.id, product: r.pn, warehouse: r.wn, qty: `${Number(r.qn)} → ${nq}`, avg: `${Number(r.a)} → ${na}`, reserved: `${Number(r.rq)} → 0`, nq, na });
    }
  }
  const missing = [...state.entries()].filter(([k]) => !seen.has(k)).map(([, s]) => s);
  console.log(`\nStock rebuild: ${diffs.length} balance row(s) change, ${missing.length} new row(s).`);
  if (diffs.length) console.table(diffs.slice(0, 30).map(({ product, warehouse, qty, avg, reserved }) => ({ product, warehouse, qty, avg, reserved })));
  if (diffs.length > 30) console.log(`… and ${diffs.length - 30} more`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was changed. After a backup run:  node scripts/reset-sales-documents.js --apply --confirm=${db}\n`);
    await c.end();
    return;
  }

  await c.beginTransaction();
  try {
    await c.query('SET FOREIGN_KEY_CHECKS = 0');
    // 1) preserve cash legs: convert those entries in place
    for (const j of cashJes) {
      const label = j.st === 'sales_invoice' ? 'فاتورة' : 'مردود';
      const desc = `${j.net > 0 ? 'تحصيل' : 'صرف'} نقدي محفوظ — ${label} ملغاة ${j.docNo} (إعادة إدخال الفواتير)`;
      await q(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ? AND id NOT IN (${ph(j.cashLineIds)})`, [j.id, ...j.cashLineIds]);
      const amount = Math.abs(j.net);
      await q(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, line_number, debit, credit, description, customer_id, created_at, updated_at, version)
         VALUES (?, ?, ?, 99, ?, ?, ?, ?, NOW(), NOW(), 1)`,
        [crypto.randomUUID(), j.id, settings.cc, j.net < 0 ? amount : 0, j.net > 0 ? amount : 0, desc, j.customerId],
      );
      const tot = (await q('SELECT ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c FROM journal_entry_lines WHERE journal_entry_id = ?', [j.id]))[0];
      await q("UPDATE journal_entries SET source_type = 'manual', description = ?, total_debit = ?, total_credit = ? WHERE id = ?", [desc, tot.d, tot.c, j.id]);
      await q("UPDATE treasury_transactions SET source_type = 'manual', description = ? WHERE journal_entry_id = ?", [desc, j.id]);
      await q("UPDATE bank_transactions SET source_type = 'manual', description = ? WHERE journal_entry_id = ?", [desc, j.id]);
      await q(
        `INSERT INTO customer_transactions (id, customer_id, transaction_date, type, source_type, source_id, source_number, debit, credit, description, created_at, updated_at, version)
         SELECT ?, ?, entry_date, 'adjustment', 'manual', id, entry_number, ?, ?, ?, NOW(), NOW(), 1 FROM journal_entries WHERE id = ?`,
        [crypto.randomUUID(), j.customerId, j.net < 0 ? amount : 0, j.net > 0 ? amount : 0, desc, j.id],
      );
    }
    // 2) delete everything else those documents posted
    await q(`DELETE FROM customer_transactions WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
    await q(`DELETE FROM supplier_transactions WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
    await q(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM (SELECT id FROM journal_entries WHERE ${delJeWhere}) x)`, delJeParams);
    await q(`DELETE FROM journal_entries WHERE ${delJeWhere}`, delJeParams);
    await q(`DELETE FROM stock_movements WHERE source_type IN (${ph(SOURCES)})`, SOURCES);
    for (const t of DOC_TABLES) await q(`DELETE FROM \`${t}\``);
    await q(`DELETE FROM document_sequences WHERE ${SEQ_PREFIXES.map(() => '`key` LIKE ?').join(' OR ')}`, SEQ_PREFIXES.map((p) => `${p}:%`));
    // 3) stock rebuilt, no reservations
    await q('UPDATE warehouse_stock SET reserved_quantity = 0');
    for (const d of diffs) await q('UPDATE warehouse_stock SET quantity = ?, avg_cost = ? WHERE id = ?', [d.nq, d.na, d.id]);
    for (const s of missing) {
      await q('INSERT INTO warehouse_stock (id, warehouse_id, product_id, quantity, reserved_quantity, avg_cost, created_at, updated_at, version) VALUES (?, ?, ?, ?, 0, ?, NOW(), NOW(), 1)',
        [crypto.randomUUID(), s.w, s.p, r3(s.q), r2(s.avg)]);
    }
    // 4) guard: treasury / bank balances must be identical
    const tre1 = await q('SELECT treasury_id t, ROUND(SUM(debit - credit), 2) b FROM treasury_transactions WHERE deleted_at IS NULL GROUP BY treasury_id');
    const bnk1 = await q('SELECT bank_account_id t, ROUND(SUM(debit - credit), 2) b FROM bank_transactions WHERE deleted_at IS NULL GROUP BY bank_account_id');
    const same = (a, b) => JSON.stringify(a.map((r) => [r.t, String(r.b)]).sort()) === JSON.stringify(b.map((r) => [r.t, String(r.b)]).sort());
    if (!same(tre0, tre1) || !same(bnk0, bnk1)) throw new Error('treasury/bank balances would change — aborted');
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
    await c.commit();
    console.log('\nAPPLIED ✔  Documents removed, cash legs preserved (treasury/bank unchanged), stock rebuilt, numbering restarts at 1.\n');
  } catch (e) {
    await c.rollback();
    await c.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
    console.error('\nFAILED — rolled back, nothing changed:', e.message, '\n');
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
