import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Treasury } from '../treasury/entities/treasury.entity';
import { BankAccount } from '../bank-account/entities/bank-account.entity';
import { TreasuryLedgerService } from '../treasury/treasury-ledger.service';
import { TreasuryTransactionType } from '../treasury/enums/treasury-transaction.enum';
import { BankLedgerService } from '../bank-account/bank-ledger.service';
import { BankTransactionType } from '../bank-account/enums/bank-transaction.enum';

/** Which cash document is driving the movement (picks the subledger label + side). */
export type CashDocumentKind =
  | 'sale_invoice'
  | 'purchase_invoice'
  | 'sale_return'
  | 'purchase_return';

export interface CashSubledgerInput {
  /** The GL cash/bank account the document settles through. */
  cashAccountId: string | null | undefined;
  documentKind: CashDocumentKind;
  amount: number;
  /** When true, records the OPPOSITE side (used on document reversal). */
  reversal?: boolean;
  transactionDate: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  /** The document's own journal entry — linked for traceability, never re-posted. */
  journalEntryId: string | null;
  description: string;
  actorId?: string;
}

/**
 * Mirrors the cash/bank leg of a CASH sales/purchase invoice (or return) into the
 * operational treasury/bank subledger so it shows up in the cashbox statement —
 * WITHOUT creating any journal entry (the source document's own journal already
 * debits/credits the cash GL account; a second journal would double-count).
 *
 * The operational treasury/bank is resolved from the GL cash account via its
 * `accountId` mapping. If the cash account maps to no treasury/bank (a plain GL
 * cash account), this is a safe no-op — the general ledger is still correct.
 *
 * Every method receives the caller's transaction `manager`, so the subledger row
 * commits atomically with the rest of the posting.
 */
@Injectable()
export class CashSubledgerService {
  constructor(
    private readonly treasuryLedger: TreasuryLedgerService,
    private readonly bankLedger: BankLedgerService,
  ) {}

  async record(input: CashSubledgerInput, manager: EntityManager): Promise<void> {
    if (!input.cashAccountId || input.amount <= 0) return;

    const reversal = input.reversal ?? false;
    const inflow = this.isInflow(input.documentKind, reversal);
    const base = {
      transactionDate: input.transactionDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      debit: inflow ? input.amount : 0,
      credit: inflow ? 0 : input.amount,
      description: input.description,
      journalEntryId: input.journalEntryId,
      actorId: input.actorId,
    };

    const treasury = await manager
      .getRepository(Treasury)
      .findOne({ where: { accountId: input.cashAccountId } });
    if (treasury) {
      await this.treasuryLedger.record(
        { treasuryId: treasury.id, type: this.treasuryType(input.documentKind, reversal), ...base },
        manager,
      );
      return;
    }

    const bank = await manager
      .getRepository(BankAccount)
      .findOne({ where: { accountId: input.cashAccountId } });
    if (bank) {
      await this.bankLedger.record(
        { bankAccountId: bank.id, type: this.bankType(inflow, reversal), ...base },
        manager,
      );
    }
    // else: GL cash account not tied to an operational treasury/bank — nothing to mirror.
  }

  /** Natural money direction of each document, flipped on reversal. */
  private isInflow(kind: CashDocumentKind, reversal: boolean): boolean {
    // Money IN: cash sale, cash purchase-return (supplier refunds us).
    // Money OUT: cash purchase, cash sale-return (we refund the customer).
    const naturalInflow = kind === 'sale_invoice' || kind === 'purchase_return';
    return reversal ? !naturalInflow : naturalInflow;
  }

  private treasuryType(kind: CashDocumentKind, reversal: boolean): TreasuryTransactionType {
    if (reversal) return TreasuryTransactionType.REVERSAL;
    switch (kind) {
      case 'sale_invoice':
        return TreasuryTransactionType.CASH_SALE;
      case 'purchase_invoice':
        return TreasuryTransactionType.CASH_PURCHASE;
      case 'sale_return':
        return TreasuryTransactionType.CASH_SALE_RETURN;
      case 'purchase_return':
        return TreasuryTransactionType.CASH_PURCHASE_RETURN;
    }
  }

  private bankType(inflow: boolean, reversal: boolean): BankTransactionType {
    if (reversal) return BankTransactionType.REVERSAL;
    return inflow ? BankTransactionType.RECEIPT : BankTransactionType.PAYMENT;
  }
}
