-- ============================================================================
-- READ-ONLY revenue / sales reconciliation (changes nothing).
-- Explains why sales / revenue totals differ between reports for one period.
-- Usage (from the backend folder, after `set -a; . ./.env; set +a`):
--   mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USERNAME" -p"$DB_PASSWORD" "$DB_DATABASE" < scripts/diagnose-revenue.sql > ~/revenue-check.txt
-- Change the period on the two lines below.
-- ============================================================================
SET @from = '2026-01-01';
SET @to   = '2026-12-31';

SELECT '1) POSTED SALES INVOICES (header totals vs line totals)' AS section;
SELECT COUNT(*) AS invoices,
       ROUND(SUM(si.subtotal), 2)        AS header_subtotal,
       ROUND(SUM(si.discount_amount), 2) AS header_discount,
       ROUND(SUM(si.taxable_amount), 2)  AS header_before_tax,
       ROUND(SUM(si.vat_amount), 2)      AS header_vat,
       ROUND(SUM(si.total_amount), 2)    AS header_total_with_vat,
       ROUND(SUM((SELECT COALESCE(SUM(ii.net_before_tax), 0) FROM sales_invoice_items ii WHERE ii.sales_invoice_id = si.id AND ii.deleted_at IS NULL)), 2) AS lines_before_tax
  FROM sales_invoices si
 WHERE si.deleted_at IS NULL AND si.status = 'posted' AND si.invoice_date BETWEEN @from AND @to;

SELECT '2) INVOICES BY STATUS IN THE PERIOD' AS section;
SELECT si.status, COUNT(*) AS invoices, ROUND(SUM(si.taxable_amount), 2) AS before_tax
  FROM sales_invoices si
 WHERE si.deleted_at IS NULL AND si.invoice_date BETWEEN @from AND @to
 GROUP BY si.status;

SELECT '3) LEDGER REVENUE BY ACCOUNT AND SOURCE (posted entries in the period)' AS section;
SELECT a.account_code, a.account_name_ar, a.account_sub_type, je.source_type,
       COUNT(DISTINCT je.id) AS entries,
       ROUND(SUM(l.credit - l.debit), 2) AS revenue
  FROM journal_entry_lines l
  JOIN journal_entries je ON je.id = l.journal_entry_id AND je.deleted_at IS NULL
  JOIN chart_of_accounts a ON a.id = l.account_id
 WHERE je.is_posted = 1 AND l.deleted_at IS NULL AND a.account_type = 'revenue'
   AND je.entry_date BETWEEN @from AND @to
 GROUP BY a.account_code, a.account_name_ar, a.account_sub_type, je.source_type
 ORDER BY a.account_code, je.source_type;

SELECT '4) POSTED INVOICES WHOSE ENTRY REVENUE <> INVOICE BEFORE-TAX (first 50)' AS section;
SELECT si.invoice_number, si.invoice_date, ROUND(si.taxable_amount, 2) AS invoice_before_tax,
       ROUND(COALESCE(x.revenue, 0), 2) AS ledger_revenue, x.entry_dates,
       ROUND(si.taxable_amount - COALESCE(x.revenue, 0), 2) AS difference
  FROM sales_invoices si
  LEFT JOIN (
    SELECT je.source_id, SUM(l.credit - l.debit) AS revenue, GROUP_CONCAT(DISTINCT je.entry_date) AS entry_dates
      FROM journal_entries je
      JOIN journal_entry_lines l ON l.journal_entry_id = je.id AND l.deleted_at IS NULL
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_type = 'revenue'
     WHERE je.source_type = 'sales_invoice' AND je.is_posted = 1 AND je.deleted_at IS NULL
     GROUP BY je.source_id
  ) x ON x.source_id = si.id
 WHERE si.deleted_at IS NULL AND si.status = 'posted' AND si.invoice_date BETWEEN @from AND @to
   AND ABS(si.taxable_amount - COALESCE(x.revenue, 0)) > 0.01
 ORDER BY si.invoice_date
 LIMIT 50;

SELECT '5) INVOICES WHOSE ENTRY IS IN ANOTHER PERIOD THAN THE INVOICE (first 50)' AS section;
SELECT si.invoice_number, si.invoice_date, je.entry_number, je.entry_date, si.status
  FROM sales_invoices si
  JOIN journal_entries je ON je.id = si.journal_entry_id
 WHERE si.deleted_at IS NULL AND si.status IN ('posted', 'reversed')
   AND (si.invoice_date BETWEEN @from AND @to OR je.entry_date BETWEEN @from AND @to)
   AND (je.entry_date < @from OR je.entry_date > @to OR si.invoice_date < @from OR si.invoice_date > @to)
 LIMIT 50;

SELECT '6) REVERSED INVOICES: invoice in the period, reversal entry date' AS section;
SELECT si.invoice_number, si.invoice_date, ROUND(si.taxable_amount, 2) AS before_tax, rje.entry_number AS reversal_entry, rje.entry_date AS reversal_date
  FROM sales_invoices si
  LEFT JOIN journal_entries rje ON rje.id = si.reversal_journal_entry_id
 WHERE si.deleted_at IS NULL AND si.status = 'reversed'
   AND (si.invoice_date BETWEEN @from AND @to OR rje.entry_date BETWEEN @from AND @to);

SELECT '7) POSTED SALES RETURNS (header vs lines) in the period' AS section;
SELECT COUNT(*) AS returns_count,
       ROUND(SUM(sr.taxable_amount), 2) AS header_before_tax,
       ROUND(SUM(sr.total_amount), 2)   AS header_total_with_vat,
       ROUND(SUM((SELECT COALESCE(SUM(ri.net_before_tax), 0) FROM sales_return_items ri WHERE ri.sales_return_id = sr.id AND ri.deleted_at IS NULL)), 2) AS lines_before_tax
  FROM sales_returns sr
 WHERE sr.deleted_at IS NULL AND sr.status = 'posted' AND sr.return_date BETWEEN @from AND @to;

SELECT '8) RETURNS OF INVOICES FROM ANOTHER PERIOD (first 50)' AS section;
SELECT sr.return_number, sr.return_date, sr.invoice_number, si.invoice_date, ROUND(sr.taxable_amount, 2) AS before_tax
  FROM sales_returns sr
  LEFT JOIN sales_invoices si ON si.id = sr.sales_invoice_id
 WHERE sr.deleted_at IS NULL AND sr.status = 'posted'
   AND (sr.return_date BETWEEN @from AND @to) <> (si.invoice_date BETWEEN @from AND @to)
 LIMIT 50;

SELECT '9) MANUAL / OTHER ENTRIES ON REVENUE ACCOUNTS (not invoices / returns, first 50)' AS section;
SELECT je.entry_number, je.entry_date, je.source_type, je.status, a.account_code, ROUND(l.credit - l.debit, 2) AS revenue, LEFT(COALESCE(l.description, je.description), 80) AS description
  FROM journal_entry_lines l
  JOIN journal_entries je ON je.id = l.journal_entry_id AND je.deleted_at IS NULL
  JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_type = 'revenue'
 WHERE je.is_posted = 1 AND l.deleted_at IS NULL AND je.entry_date BETWEEN @from AND @to
   AND je.source_type NOT IN ('sales_invoice', 'sales_return')
 ORDER BY je.entry_date
 LIMIT 50;

SELECT '10) INVOICE LINES WITHOUT ANY RECORDED COST (posted, in the period)' AS section;
SELECT ii.line_type, COUNT(*) AS line_count,ROUND(SUM(ii.net_before_tax), 2) AS before_tax
  FROM sales_invoice_items ii
  JOIN sales_invoices si ON si.id = ii.sales_invoice_id AND si.deleted_at IS NULL AND si.status = 'posted'
 WHERE ii.deleted_at IS NULL AND si.invoice_date BETWEEN @from AND @to
   AND ii.cogs_accrued = 0
   AND NOT EXISTS (SELECT 1 FROM sales_delivery_items di WHERE di.sales_invoice_item_id = ii.id AND di.deleted_at IS NULL AND di.line_cost > 0)
 GROUP BY ii.line_type;

SELECT '11) LEDGER COST OF SALES BY SOURCE (posted, in the period)' AS section;
SELECT je.source_type, ROUND(SUM(l.debit - l.credit), 2) AS cogs
  FROM journal_entry_lines l
  JOIN journal_entries je ON je.id = l.journal_entry_id AND je.deleted_at IS NULL
  JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_type = 'expense' AND a.account_sub_type = 'cogs'
 WHERE je.is_posted = 1 AND l.deleted_at IS NULL AND je.entry_date BETWEEN @from AND @to
 GROUP BY je.source_type;
