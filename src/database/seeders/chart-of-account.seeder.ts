import { DataSource, IsNull, Repository } from 'typeorm';
import { ChartOfAccount } from '../../modules/chart-of-account/entities/chart-of-account.entity';
import {
  AccountNature,
  AccountSubType,
  AccountType,
  DEFAULT_NATURE_BY_TYPE,
} from '../../modules/chart-of-account/enums/account.enum';
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  SeedAccountNode,
} from './chart-of-account.seed-data';
import { Seeder } from './seeder.interface';

/**
 * Fine-grained classification for the standard accounts, keyed by code. Drives
 * setting-specific dropdown filtering + validation. Codes not listed keep a
 * null subtype (they simply won't appear in a subtype-scoped dropdown).
 */
const SUBTYPE_BY_CODE: Record<string, AccountSubType> = {
  // Assets
  '111000': AccountSubType.CASH,
  '112000': AccountSubType.BANK,
  '121000': AccountSubType.ACCOUNTS_RECEIVABLE,
  '122000': AccountSubType.TAX_RECEIVABLE,
  '131000': AccountSubType.INVENTORY_RAW_MATERIAL,
  '132000': AccountSubType.INVENTORY_WIP,
  '133000': AccountSubType.INVENTORY_FINISHED_GOODS,
  // Liabilities
  '211000': AccountSubType.ACCOUNTS_PAYABLE,
  '221000': AccountSubType.TAX_PAYABLE,
  '231000': AccountSubType.OTHER_PAYABLE,
  // Equity
  '310000': AccountSubType.CAPITAL,
  '320000': AccountSubType.RETAINED_EARNINGS,
  '330000': AccountSubType.OPENING_BALANCE_EQUITY,
  // Revenue
  '410000': AccountSubType.SALES_REVENUE,
  // Costs
  '510000': AccountSubType.COGS,
  // General & administrative expenses
  '611000': AccountSubType.OPERATING_EXPENSE,
  '612000': AccountSubType.INVENTORY_ADJUSTMENT,
  '613000': AccountSubType.OPERATING_EXPENSE,
};

/**
 * Builds the complete default Chart of Accounts from the declarative template
 * in {@link DEFAULT_CHART_OF_ACCOUNTS}.
 *
 * The builder walks the tree top-down and, for each node, derives:
 *  - `level`        = depth (root = 1)
 *  - `parentId`     = the persisted parent
 *  - `accountType`  = inherited from the nearest ancestor that declares one
 *  - `accountNature`= the node's override, else the type's default side
 *  - `isHeader`     = has children
 *  - `allowPosting` = leaf (mutually exclusive with isHeader)
 *  - `isSystem`     = true for structural (header) accounts, protecting the
 *                     backbone of the chart from deletion
 *
 * Idempotent: an account is matched by its unique `accountCode` and skipped if
 * it already exists, so running the seeder repeatedly never creates duplicates.
 */
export class ChartOfAccountSeeder implements Seeder {
  readonly name = 'ChartOfAccountSeeder';

  /** Legacy single-digit roots (1..5) from the first minimal seeder. */
  private readonly legacyRootCodes = ['1', '2', '3', '4', '5'];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(ChartOfAccount);

    await this.removeLegacyRoots(repo);

    let created = 0;
    for (const root of DEFAULT_CHART_OF_ACCOUNTS) {
      created += await this.seedNode(repo, root, null, 1, undefined);
    }

    const total = await repo.count();
    // eslint-disable-next-line no-console
    console.log(
      `     ↳ chart of accounts: ${created} new account(s), ${total} total`,
    );
  }

  /**
   * Persists a single node (if missing) then recurses into its children.
   * Returns the number of accounts newly created in this subtree.
   */
  private async seedNode(
    repo: Repository<ChartOfAccount>,
    node: SeedAccountNode,
    parentId: string | null,
    level: number,
    inheritedType: AccountType | undefined,
  ): Promise<number> {
    const accountType = node.type ?? inheritedType;
    if (!accountType) {
      throw new Error(
        `Seed account "${node.code}" has no accountType and no ancestor provides one.`,
      );
    }

    const isHeader = !!node.children?.length;
    const accountNature =
      node.nature ?? DEFAULT_NATURE_BY_TYPE[accountType];

    const subType = SUBTYPE_BY_CODE[node.code] ?? null;

    let created = 0;
    let account = await repo.findOne({ where: { accountCode: node.code } });

    if (!account) {
      account = await repo.save(
        repo.create({
          accountCode: node.code,
          accountNameAr: node.nameAr,
          accountNameEn: node.nameEn,
          accountType,
          accountNature,
          accountSubType: subType,
          currencyId: null,
          level,
          isHeader,
          allowPosting: !isHeader,
          isActive: true,
          isSystem: isHeader, // protect the structural backbone
          description: node.description ?? null,
          parentId,
        }),
      );
      created += 1;
    } else if (subType && account.accountSubType === null) {
      // Backfill classification onto pre-existing seeded accounts (never
      // overwrites a subtype the user set manually).
      account.accountSubType = subType;
      await repo.save(account);
    }

    for (const child of node.children ?? []) {
      created += await this.seedNode(
        repo,
        child,
        account.id,
        level + 1,
        accountType,
      );
    }

    return created;
  }

  /**
   * Removes the five single-digit system roots created by the original minimal
   * seeder, but only when they are empty (no children) — so a chart a user has
   * already built on top of them is never destroyed. Hard delete, since these
   * were seed data, not user records.
   */
  private async removeLegacyRoots(
    repo: Repository<ChartOfAccount>,
  ): Promise<void> {
    for (const code of this.legacyRootCodes) {
      const legacy = await repo.findOne({
        where: { accountCode: code, parentId: IsNull() },
      });
      if (!legacy) {
        continue;
      }
      const childCount = await repo.count({
        where: { parentId: legacy.id },
      });
      if (childCount > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `     ↳ legacy root "${code}" has children — left in place; ` +
            'the new 6-digit roots will be added alongside it.',
        );
        continue;
      }
      await repo.delete({ id: legacy.id });
    }
  }
}
