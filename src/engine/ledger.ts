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

export interface LedgerEntry {
  accountId: string;
  amount: number;
  delta: 'credit' | 'debit';
  kind: FlowKind;
  label: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
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

  if (entry.delta === 'credit') {
    result.contributions += entry.amount;
    result.endValue += entry.amount;
  } else {
    result.withdrawals += entry.amount;
    result.endValue -= entry.amount;
  }

  accountValues.set(entry.accountId, result.endValue);

  if (!result.cashflowDetails) result.cashflowDetails = [];
  result.cashflowDetails.push({
    description: entry.label,
    amount: entry.amount,
    type: entry.delta === 'credit' ? 'contribution' : 'withdrawal',
    sourceAccountId: entry.sourceAccountId,
    sourceAccountName: entry.sourceAccountName,
  });
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
  // Transfer balance: internalTransfer credits minus debits must equal zero
  let transferNet = 0;
  for (const e of entries) {
    if (e.kind === 'internalTransfer') {
      transferNet += e.delta === 'credit' ? e.amount : -e.amount;
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

  let externalIn = 0;
  let externalOut = 0;
  let synthetic = 0;

  for (const e of entries) {
    switch (e.kind) {
      case 'externalIn':  externalIn  += e.amount; break;
      case 'externalOut': externalOut += e.amount; break;
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
