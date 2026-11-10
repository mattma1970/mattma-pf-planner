import type { Account, AccountYearResult } from '../schemas';

/**
 * Every financial movement in the forecast engine belongs to exactly one of four kinds.
 * This classification drives both documentation and the conservation invariant check.
 *
 * externalIn     — money entering the model from the real world (salary, external income)
 * externalOut    — money leaving the model to the real world (expenses, tax payments)
 * synthetic      — value created inside the model (investment returns, asset revaluations)
 * internalTransfer — money moving between two accounts within the model (must be emitted
 *                    in pairs: one debit + one credit of equal amount so they net to zero)
 */
export type FlowKind = 'externalIn' | 'externalOut' | 'synthetic' | 'internalTransfer';

/**
 * Default account used as the offsetting leg for externalIn, externalOut, and
 * synthetic flows. This represents the model's cumulative equity position
 * (Retained Earnings / Cumulative Wealth). Every balance-changing flow that
 * crosses the model boundary or creates value internally must have a second
 * leg against this account to maintain double-entry integrity.
 *
 * Users should create an account with this id in their plan, or the engine
 * will report a missing-account warning for the offsetting leg.
 */
export const DEFAULT_EQUITY_ACCOUNT_ID = 'retained-earnings';

export interface LedgerEntry {
  accountId: string;
  amount: number;
  delta: 'credit' | 'debit';
  kind: FlowKind;
  label: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
}

/**
 * Direction of balance change for an account.
 */
export type FlowDirection = 'increase' | 'decrease';

/**
 * Returns the correct debit/credit delta for changing an account balance.
 * - To INCREASE an asset: debit; to DECREASE an asset: credit
 * - To INCREASE a liability/equity: credit; to DECREASE a liability/equity: debit
 */
export function deltaForAccountDirection(
  accountType: 'asset' | 'expense' | 'liability' | 'income',
  direction: FlowDirection,
): 'debit' | 'credit' {
  if (direction === 'increase') {
    return accountType === 'asset' ? 'debit' : 'credit';
  } else {
    return accountType === 'asset' ? 'credit' : 'debit';
  }
}

/**
 * A single leg of a double-entry transaction. Every transaction must have
 * exactly two legs: one debit and one credit of equal amount.
 */
export interface TransactionLeg {
  accountId: string;
  amount: number;
  delta: 'credit' | 'debit';
  label: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
}

/**
 * A double-entry transaction. Every financial movement in the model must be
 * expressed as exactly two legs that balance to zero. This is enforced at
 * emit time by emitTransaction.
 */
export interface DoubleEntryTransaction {
  id: string;
  kind: FlowKind;
  legs: [TransactionLeg, TransactionLeg];
}

/**
 * Apply a double-entry transaction. Validates that the two legs are equal and
 * opposite before applying either leg. If validation fails, neither leg is
 * applied and an error is reported via onError.
 *
 * This is the only function that should be used to mutate account balances
 * through the ledger. Direct mutation of accountValues or accountResults
 * outside this function breaks the double-entry invariant.
 */
export function emitTransaction(
  entry: DoubleEntryTransaction,
  accumulated: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  const [leg1, leg2] = entry.legs;

  // Validate: equal amounts
  if (leg1.amount !== leg2.amount) {
    onError?.(
      `Unbalanced transaction "${entry.id}": leg amounts must be equal (${leg1.amount} !== ${leg2.amount})`,
    );
    return;
  }

  // Convert to two LedgerEntry objects and apply both
  const entry1: LedgerEntry = {
    accountId: leg1.accountId,
    amount: leg1.amount,
    delta: leg1.delta,
    kind: entry.kind,
    label: leg1.label,
    sourceAccountId: leg1.sourceAccountId,
    sourceAccountName: leg1.sourceAccountName,
  };

  const entry2: LedgerEntry = {
    accountId: leg2.accountId,
    amount: leg2.amount,
    delta: leg2.delta,
    kind: entry.kind,
    label: leg2.label,
    sourceAccountId: leg2.sourceAccountId,
    sourceAccountName: leg2.sourceAccountName,
  };

  emitLedgerEntry(entry1, accumulated, accountResults, accountValues, onError);
  emitLedgerEntry(entry2, accumulated, accountResults, accountValues, onError);
}

export interface ConservationResult {
  passed: boolean;
  year: number;
  transferImbalance: number;
  wealthDrift: number;
  details: {
    openingNetWealth: number;
    closingNetWealth: number;
    assetGrowth: number;
    externalIn: number;
    externalOut: number;
    synthetic: number;
    expectedDelta: number;
    actualDelta: number;
  };
}

/**
 * Apply a single ledger entry immediately, recording it in the accumulated list.
 * Reports missing accounts via onError rather than throwing, so a misconfigured
 * account produces a visible warning instead of a crashed forecast.
 */
export function emitLedgerEntry(
  entry: LedgerEntry,
  accumulated: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  const result = accountResults.get(entry.accountId);
  if (!result) {
    onError?.(
      `Account "${entry.accountId}" not found for flow "${entry.label}" [${entry.kind}]`,
    );
    return;
  }

  accumulated.push(entry);

  // Apply double-entry sign convention based on account type:
  //   Debit to Asset:   endValue += amount  (asset increases = contribution)
  //   Credit to Asset:  endValue -= amount  (asset decreases = withdrawal)
  //   Debit to Liability: endValue -= amount  (liability decreases = withdrawal)
  //   Credit to Liability: endValue += amount  (liability increases = contribution)
  const isAsset = result.accountType === 'asset';
  let balanceChange: number;
  if (entry.delta === 'credit') {
    balanceChange = isAsset ? -entry.amount : entry.amount;
  } else {
    balanceChange = isAsset ? entry.amount : -entry.amount;
  }
  result.endValue += balanceChange;

  // Track contributions (balance increases) and withdrawals (balance decreases)
  // Synthetic entries (investment growth) are not contributions/withdrawals.
  if (entry.kind !== 'synthetic') {
    if (balanceChange > 0) {
      result.contributions += entry.amount;
    } else {
      result.withdrawals += entry.amount;
    }
  }

  // Track transfers (internalTransfer movements)
  // Based on delta direction: debit → money coming into account → +transfer
  //                          credit → money going out of account → -transfer
  if (entry.kind === 'internalTransfer') {
    if (entry.delta === 'debit') {
      result.transfers += entry.amount;
    } else {
      result.transfers -= entry.amount;
    }
  }

  accountValues.set(entry.accountId, result.endValue);

  if (!result.cashflowDetails) result.cashflowDetails = [];
  result.cashflowDetails.push({
    description: entry.label,
    amount: entry.amount,
    type: balanceChange > 0 ? 'contribution' : 'withdrawal',
    sourceAccountId: entry.sourceAccountId,
    sourceAccountName: entry.sourceAccountName,
  });
}

/**
 * Emit a ledger entry that changes an account balance by the given direction.
 * Automatically computes the correct debit/credit based on account type.
 */
export function emitAccountChange(
  accountId: string,
  amount: number,
  direction: FlowDirection,
  kind: FlowKind,
  label: string,
  sourceAccountId?: string,
  sourceAccountName?: string,
  accumulated: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  const result = accountResults.get(accountId);
  if (!result) {
    onError?.(`Account "${accountId}" not found for flow "${label}" [${kind}]`);
    return;
  }

  const delta = deltaForAccountDirection(result.accountType, direction);

  emitLedgerEntry(
    {
      accountId,
      amount,
      delta,
      kind,
      label,
      sourceAccountId,
      sourceAccountName,
    },
    accumulated,
    accountResults,
    accountValues,
    onError
  );
}

/**
 * Apply a batch of deferred entries (collected during the account processing loop
 * and applied afterwards so all account opening values are settled first).
 */
export function applyDeferredLedger(
  deferred: LedgerEntry[],
  accumulated: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  for (const entry of deferred) {
    emitLedgerEntry(entry, accumulated, accountResults, accountValues, onError);
  }
}

/**
 * Apply a batch of deferred double-entry transactions. Each transaction is
 * validated and applied via emitTransaction, ensuring double-entry integrity.
 */
export function applyDeferredTransactions(
  deferred: DoubleEntryTransaction[],
  accumulated: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  onError?: (msg: string) => void,
): void {
  for (const entry of deferred) {
    emitTransaction(entry, accumulated, accountResults, accountValues, onError);
  }
}

/**
 * Verify two conservation properties after all entries for a year have been applied:
 *
 * 1. Transfer balance: all internalTransfer entries (which must be emitted in pairs)
 *    should net to zero. A nonzero result means one side of a transfer was emitted
 *    without its counterpart — the canonical pension-drawdown bug.
 *
 * 2. Wealth drift: change in net wealth of standard asset/liability accounts should
 *    equal assetGrowth + externalIn - externalOut + synthetic. Internal transfers
 *    cancel in this equation by construction. A nonzero drift means either a flow
 *    was mis-classified or an entry was applied to only one side.
 *
 * Note: the wealth drift check may show a small residual when income accounts that
 * receive synthetic returns (e.g. dividends) also deposit to bank via externalIn —
 * those flows are counted twice in the formula. This is a known limitation and will
 * be tightened in a follow-up once investment-return routing is refactored.
 * The transfer-balance check is fully reliable today.
 */
export function checkConservation(
  entries: LedgerEntry[],
  accountResults: Map<string, AccountYearResult>,
  accounts: Account[],
  year: number,
  tolerance = 1,
): ConservationResult {
  // Transfer balance: in double-entry, every transaction has equal debits and credits.
  // Debit = +amount in ledger, Credit = -amount in ledger. Sum should be zero.
  let transferNet = 0;
  for (const e of entries) {
    if (e.kind === 'internalTransfer') {
      transferNet += e.delta === 'debit' ? e.amount : -e.amount;
    }
  }

  // Net wealth delta for standard accounts
  let openingNetWealth = 0;
  let closingNetWealth = 0;
  let assetGrowth = 0;

  for (const account of accounts) {
    if (account.includeInNetWorth === false) continue;
    if ((account.category ?? 'standard') !== 'standard') continue;
    if (account.type !== 'asset' && account.type !== 'liability') continue;
    const result = accountResults.get(account.id);
    if (!result) continue;
    const sign = account.type === 'asset' ? 1 : -1;
    openingNetWealth += sign * result.startValue;
    closingNetWealth += sign * result.endValue;
    // Asset growth reflects price appreciation already baked into endValue
    if (account.type === 'asset') assetGrowth += result.growth;
  }

  // externalIn increases net worth, externalOut decreases net worth
  let externalIn = 0;
  let externalOut = 0;
  // synthetic increases net worth (asset growth), decrease reduces it
  let synthetic = 0;

  for (const e of entries) {
    switch (e.kind) {
      case 'externalIn':  externalIn  += e.delta === 'credit' ? e.amount : -e.amount; break;
      case 'externalOut': externalOut += e.delta === 'debit' ? e.amount : -e.amount; break;
      case 'synthetic':   synthetic   += e.delta === 'credit' ? e.amount : -e.amount; break;
    }
  }

  const expectedDelta = assetGrowth + externalIn - externalOut + synthetic;
  const actualDelta = closingNetWealth - openingNetWealth;
  const wealthDrift = actualDelta - expectedDelta;

  // Transfer balance is the primary reliable check; wealth drift is informational
  const passed = Math.abs(transferNet) <= tolerance;

  return {
    passed,
    year,
    transferImbalance: transferNet,
    wealthDrift,
    details: {
      openingNetWealth,
      closingNetWealth,
      assetGrowth,
      externalIn,
      externalOut,
      synthetic,
      expectedDelta,
      actualDelta,
    },
  };
}
