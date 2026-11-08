import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer / supplier opening balances were posted to the general ledger only —
 * never to the customers' / suppliers' own ledgers, so their statements and
 * balances missed them. Back-fills those rows for every opening balance already
 * posted (and, for a reversed one, its reversal too). Only rows that are not
 * there yet are added, so it is safe to run on any database. Amounts / sides are
 * exactly the opening-balance lines (same as the GL entry).
 */
export class OpeningBalancePartyLedgers1792800000000 implements MigrationInterface {
  name = 'OpeningBalancePartyLedgers1792800000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [table, partyCol, refType] of [
      ['customer_transactions', 'customer_id', 'customer'],
      ['supplier_transactions', 'supplier_id', 'supplier'],
    ] as const) {
      // the opening balance itself (posted or later reversed)
      await q.query(
        `INSERT INTO \`${table}\` (\`id\`, \`${partyCol}\`, \`transaction_date\`, \`type\`, \`source_type\`, \`source_id\`, \`source_number\`, \`debit\`, \`credit\`, \`description\`, \`created_by\`)
         SELECT UUID(), d.\`${partyCol}\`, ob.\`opening_date\`, 'opening_balance', 'opening_balance', ob.\`id\`, je.\`entry_number\`, d.\`debit\`, d.\`credit\`, 'رصيد افتتاحي', ob.\`posted_by\`
           FROM \`opening_balance_details\` d
           JOIN \`opening_balances\` ob ON ob.\`id\` = d.\`opening_balance_id\`
           LEFT JOIN \`journal_entries\` je ON je.\`id\` = ob.\`journal_entry_id\`
          WHERE d.\`reference_type\` = '${refType}' AND d.\`${partyCol}\` IS NOT NULL
            AND (d.\`debit\` > 0 OR d.\`credit\` > 0)
            AND ob.\`status\` IN ('posted', 'reversed') AND ob.\`deleted_at\` IS NULL AND d.\`deleted_at\` IS NULL
            AND NOT EXISTS (SELECT 1 FROM \`${table}\` t
                             WHERE t.\`source_type\` = 'opening_balance' AND t.\`source_id\` = ob.\`id\`
                               AND t.\`${partyCol}\` = d.\`${partyCol}\` AND t.\`type\` = 'opening_balance')`,
      );
      // its reversal (sides swapped, on the reversal date)
      await q.query(
        `INSERT INTO \`${table}\` (\`id\`, \`${partyCol}\`, \`transaction_date\`, \`type\`, \`source_type\`, \`source_id\`, \`source_number\`, \`debit\`, \`credit\`, \`description\`, \`created_by\`)
         SELECT UUID(), d.\`${partyCol}\`, ob.\`reversal_date\`, 'reversal', 'opening_balance', ob.\`id\`, je.\`entry_number\`, d.\`credit\`, d.\`debit\`, 'عكس رصيد افتتاحي', ob.\`reversed_by\`
           FROM \`opening_balance_details\` d
           JOIN \`opening_balances\` ob ON ob.\`id\` = d.\`opening_balance_id\`
           LEFT JOIN \`journal_entries\` je ON je.\`id\` = ob.\`reversal_journal_entry_id\`
          WHERE d.\`reference_type\` = '${refType}' AND d.\`${partyCol}\` IS NOT NULL
            AND (d.\`debit\` > 0 OR d.\`credit\` > 0)
            AND ob.\`status\` = 'reversed' AND ob.\`reversal_date\` IS NOT NULL AND ob.\`deleted_at\` IS NULL AND d.\`deleted_at\` IS NULL
            AND NOT EXISTS (SELECT 1 FROM \`${table}\` t
                             WHERE t.\`source_type\` = 'opening_balance' AND t.\`source_id\` = ob.\`id\`
                               AND t.\`${partyCol}\` = d.\`${partyCol}\` AND t.\`type\` = 'reversal')`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM \`customer_transactions\` WHERE \`source_type\` = 'opening_balance'`);
    await q.query(`DELETE FROM \`supplier_transactions\` WHERE \`source_type\` = 'opening_balance'`);
  }
}
