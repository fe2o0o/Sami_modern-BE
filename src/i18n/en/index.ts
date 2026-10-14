import { common } from './common';
import { validation } from './validation';
import { sales } from './sales';
import { finance } from './finance';
import { inventory } from './inventory';
import { masterData } from './master-data';
import { settingsReports } from './settings-reports';

/**
 * Arabic API message → English (see common/i18n/i18n.ts). One file per area:
 *  - common:           auth, guards, generic errors, branch scope, reference guard, success messages
 *  - validation:       DTO validation messages (class-validator) and common/messages
 *  - sales:            sales invoices, deliveries, returns, commissions
 *  - finance:          purchases, vouchers, journal entries, opening balances, accounting periods/fiscal years
 *  - inventory:        stock, adjustments, transfers, manufacturing
 *  - master-data:      customers, suppliers, products, categories, brands, units, employees, excel import
 *  - settings-reports: settings, users, roles, branches, warehouses, treasuries, banks, reports, dashboard
 */
export const EN: Record<string, string> = {
  ...common,
  ...validation,
  ...sales,
  ...finance,
  ...inventory,
  ...masterData,
  ...settingsReports,
};
