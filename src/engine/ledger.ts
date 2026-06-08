import type { Account, AccountYearResult } from '../schemas';

export type FlowKind = 'externalIn' | 'externalOut' | 'synthetic' | 'internalTransfer' | 'growth';

export const EQUITY_ACCOUNT_ID = '__equity__';

export interface JournalEntry {
  seq: number;
  year: number;
  userId: string;
  timestamp: string;
  debitAccountId: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountName: string;
  amount: number;
  label: string;
  kind?: FlowKind;
  sourceAccountId?: string;
  sourceAccountName?: string;
}

export interface DeferredJournalEntry {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  label: string;
  kind?: FlowKind;
  sourceAccountId?: string;
  sourceAccountName?: string;
}

export interface ConservationResult {
  passed: boolean;
  year: number;
  transferImbalance: number;
  wealthDrift: number;
  equityBalance: number;
  entries: JournalEntry[];
  details: {
    openingNetWealth: number;
    closingNetWealth: number;
    assetGrowth: number;
    liabilityChange: number;
    externalIn: number;
    externalOut: number;
    synthetic: number;
    expectedDelta: number;
    actualDelta: number;
  };
}

function isDebitNormal(accountId: string, accounts: Account[]): boolean {
  if (accountId === EQUITY_ACCOUNT_ID) return false;
  const account = accounts.find(a => a.id === accountId);
  if (!account) return true;
  return account.type !== 'liability';
}

function getAccountName(accountId: string, accounts: Account[]): string {
  if (accountId === EQUITY_ACCOUNT_ID) return 'Equity';
  return accounts.find(a => a.id === accountId)?.name ?? accountId;
}

let seqCounter = 0;

export function emitJournalEntry(
  params: {
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    label: string;
    kind?: FlowKind;
    sourceAccountId?: string;
    sourceAccountName?: string;
  },
  journal: JournalEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  accounts: Account[],
  year: number,
  userId: string,
  onError?: (msg: string) => void,
): void {
  const { debitAccountId, creditAccountId, amount, label, kind, sourceAccountId, sourceAccountName } = params;

  const debitResult = accountResults.get(debitAccountId);
  const creditResult = accountResults.get(creditAccountId);

  if (!debitResult) {
    onError?.(`Account "${debitAccountId}" not found for flow "${label}" [${kind ?? 'unknown'}]`);
    return;
  }
  if (!creditResult) {
    onError?.(`Account "${creditAccountId}" not found for flow "${label}" [${kind ?? 'unknown'}]`);
    return;
  }

  const debitNormalDebit = isDebitNormal(debitAccountId, accounts);
  const debitNormalCredit = isDebitNormal(creditAccountId, accounts);

  const debitDelta = debitNormalDebit ? +amount : -amount;
  const creditDelta = debitNormalCredit ? -amount : +amount;

  const entry: JournalEntry = {
    seq: ++seqCounter,
    year,
    userId,
    timestamp: new Date().toISOString(),
    debitAccountId,
    debitAccountName: getAccountName(debitAccountId, accounts),
    creditAccountId,
    creditAccountName: getAccountName(creditAccountId, accounts),
    amount,
    label,
    kind,
    sourceAccountId,
    sourceAccountName,
  };
  journal.push(entry);

  const applyDelta = (
    result: AccountYearResult,
    accountId: string,
    delta: number,
  ) => {
    if (accountId === EQUITY_ACCOUNT_ID) {
      result.endValue += delta;
      accountValues.set(accountId, result.endValue);
      return;
    }

    result.endValue += delta;
    accountValues.set(accountId, result.endValue);

    if (kind === 'growth') {
      result.growth += delta;
    } else if (kind === 'internalTransfer') {
      // For internal transfers, track flow direction: debit = inflow (+), credit = outflow (-)
      if (accountId === debitAccountId) {
        result.transfers += amount;
      } else {
        result.transfers -= amount;
      }
    } else if (delta > 0) {
      result.contributions += delta;
    } else {
      result.withdrawals += Math.abs(delta);
    }

    if (!result.cashflowDetails) result.cashflowDetails = [];
    result.cashflowDetails.push({
      description: label,
      amount,
      type: kind === 'growth' ? 'growth' : kind === 'internalTransfer' ? 'transfer' : delta > 0 ? 'contribution' : 'withdrawal',
      kind,
      sourceAccountId,
      sourceAccountName,
    });
  };

  applyDelta(debitResult, debitAccountId, debitDelta);
  applyDelta(creditResult, creditAccountId, creditDelta);
}

export function applyDeferredJournalEntries(
  deferred: DeferredJournalEntry[],
  journal: JournalEntry[],
  accountResults: Map<string, AccountYearResult>,
  accountValues: Map<string, number>,
  accounts: Account[],
  year: number,
  userId: string,
  onError?: (msg: string) => void,
): void {
  for (const entry of deferred) {
    emitJournalEntry(entry, journal, accountResults, accountValues, accounts, year, userId, onError);
  }
}

export function checkConservation(
  entries: JournalEntry[],
  accountResults: Map<string, AccountYearResult>,
  accounts: Account[],
  year: number,
  tolerance = 1,
): ConservationResult {
  const transferNet = 0;

  let openingNetWealth = 0;
  let closingNetWealth = 0;
  let assetGrowth = 0;
  let liabilityChange = 0;

  for (const account of accounts) {
    if (account.includeInNetWorth === false) continue;
    if ((account.category ?? 'standard') !== 'standard') continue;
    if (account.type !== 'asset' && account.type !== 'liability') continue;
    const result = accountResults.get(account.id);
    if (!result) continue;
    const sign = account.type === 'asset' ? 1 : -1;
    openingNetWealth += sign * result.startValue;
    closingNetWealth += sign * result.endValue;
    if (account.type === 'asset') assetGrowth += result.growth;
    // Liability principal change affects net worth: when liability decreases,
    // net worth increases by the same amount
    if (account.type === 'liability') {
      liabilityChange += -(result.endValue - result.startValue);
    }
  }

  let externalIn = 0;
  let externalOut = 0;
  let synthetic = 0;

  for (const e of entries) {
    switch (e.kind) {
      case 'externalIn':  externalIn  += e.amount; break;
      case 'externalOut': externalOut += e.amount; break;
      case 'synthetic':   synthetic   += e.amount; break;
    }
  }

  const expectedDelta = assetGrowth + externalIn - externalOut + synthetic + liabilityChange;
  const actualDelta = closingNetWealth - openingNetWealth;
  const wealthDrift = actualDelta - expectedDelta;

  const equityResult = accountResults.get(EQUITY_ACCOUNT_ID);
  const equityBalance = equityResult?.endValue ?? 0;

  const passed = Math.abs(transferNet) <= tolerance;

  return {
    passed,
    year,
    transferImbalance: transferNet,
    wealthDrift,
    equityBalance,
    entries,
    details: {
      openingNetWealth,
      closingNetWealth,
      assetGrowth,
      liabilityChange,
      externalIn,
      externalOut,
      synthetic,
      expectedDelta,
      actualDelta,
    },
  };
}
