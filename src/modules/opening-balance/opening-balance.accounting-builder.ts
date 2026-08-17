import { Injectable } from '@nestjs/common';
import { OpeningBalanceDetail } from './entities/opening-balance-detail.entity';
import { OpeningBalanceReferenceType } from './enums/opening-balance.enum';

/** One aggregated journal line (account + branch + a single side). */
export interface ImpactLine {
  accountId: string;
  /** Branch dimension — null for company-level lines (control/equity). */
  branchId: string | null;
  debit: number;
  credit: number;
  isSystemGenerated: boolean;
}

/** The complete accounting result of an opening balance. */
export interface AccountingImpact {
  journalLines: ImpactLine[];
  rawDebit: number;
  rawCredit: number;
  rawDifference: number;
  balancingLine: ImpactLine | null;
  finalDebit: number;
  finalCredit: number;
  difference: number;
  isBalanced: boolean;
}

export interface BuildImpactInput {
  details: OpeningBalanceDetail[];
  autoBalance: boolean;
  customerControlAccountId: string | null;
  supplierControlAccountId: string | null;
  equityAccountId: string | null;
  /** productId → resolved inventory account id (override or settings by type). */
  inventoryAccountByProductId: Map<string, string | null>;
}

const TOLERANCE = 0.005;

/**
 * THE single source of truth for turning opening-balance detail rows into a
 * balanced journal entry. Both the journal PREVIEW and the actual POST call
 * this, so what the user previews is exactly what gets posted.
 *
 * Rules:
 *  - each detail maps to its ledger account (GL/cash/bank → own account;
 *    customer → customer control; supplier → supplier control; inventory →
 *    resolved inventory account),
 *  - impacts are AGGREGATED by account (many customers on one control account
 *    become one line) and netted to a single side,
 *  - when auto-balancing is on, one opening-balance-equity line closes the
 *    remaining difference.
 */
@Injectable()
export class OpeningBalanceAccountingBuilder {
  build(input: BuildImpactInput): AccountingImpact {
    // Aggregate by (account + branch) so many lines on one control/cash account
    // collapse, WITHOUT merging across branches — branch-level GL traceability
    // is preserved. Customer/supplier control lines are company-level (branch null).
    const buckets = new Map<
      string,
      { accountId: string; branchId: string | null; debit: number; credit: number }
    >();
    const add = (
      accountId: string | null | undefined,
      branchId: string | null,
      debit: number,
      credit: number,
    ): void => {
      if (!accountId) return;
      const key = `${accountId}::${branchId ?? ''}`;
      const bucket =
        buckets.get(key) ?? { accountId, branchId, debit: 0, credit: 0 };
      bucket.debit += debit || 0;
      bucket.credit += credit || 0;
      buckets.set(key, bucket);
    };

    for (const d of input.details) {
      if (d.isSystemGenerated) continue; // never double-count a prior balancing line
      const debit = d.debit || 0;
      const credit = d.credit || 0;
      switch (d.referenceType) {
        case OpeningBalanceReferenceType.CUSTOMER:
          add(input.customerControlAccountId, null, debit, credit);
          break;
        case OpeningBalanceReferenceType.SUPPLIER:
          add(input.supplierControlAccountId, null, debit, credit);
          break;
        case OpeningBalanceReferenceType.INVENTORY:
          add(
            input.inventoryAccountByProductId.get(d.productId ?? '') ?? null,
            d.branchId ?? null,
            debit,
            credit,
          );
          break;
        default: // general_ledger / cash / bank
          add(d.accountId, d.branchId ?? null, debit, credit);
      }
    }

    // Net every (account+branch) to one side; drop those that net to zero.
    const journalLines: ImpactLine[] = [];
    for (const bucket of buckets.values()) {
      const net = round2(bucket.debit - bucket.credit);
      if (Math.abs(net) < TOLERANCE) continue;
      journalLines.push({
        accountId: bucket.accountId,
        branchId: bucket.branchId,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
        isSystemGenerated: false,
      });
    }

    const rawDebit = round2(journalLines.reduce((s, l) => s + l.debit, 0));
    const rawCredit = round2(journalLines.reduce((s, l) => s + l.credit, 0));
    const rawDifference = round2(rawDebit - rawCredit);

    let balancingLine: ImpactLine | null = null;
    if (
      input.autoBalance &&
      input.equityAccountId &&
      Math.abs(rawDifference) >= TOLERANCE
    ) {
      balancingLine = {
        accountId: input.equityAccountId,
        branchId: null, // opening-balance equity is company-level
        // rawDebit > rawCredit ⇒ equity credit; otherwise equity debit.
        debit: rawDifference < 0 ? -rawDifference : 0,
        credit: rawDifference > 0 ? rawDifference : 0,
        isSystemGenerated: true,
      };
      journalLines.push(balancingLine);
    }

    const finalDebit = round2(rawDebit + (balancingLine?.debit ?? 0));
    const finalCredit = round2(rawCredit + (balancingLine?.credit ?? 0));
    const difference = round2(finalDebit - finalCredit);

    return {
      journalLines,
      rawDebit,
      rawCredit,
      rawDifference,
      balancingLine,
      finalDebit,
      finalCredit,
      difference,
      isBalanced: Math.abs(difference) < TOLERANCE,
    };
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
