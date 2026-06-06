import { describe, it, expect, vi } from 'vitest';
import { emitJournalEntry, applyDeferredJournalEntries, checkConservation, EQUITY_ACCOUNT_ID, type JournalEntry, type DeferredJournalEntry } from './ledger';
import type { AccountYearResult } from '../schemas';
import { createTestAccount } from '../test/fixtures';

function makeResult(accountId: string, startValue: number, endValue = startValue): AccountYearResult {
  return {
    accountId,
    year: 2025,
    startValue,
    growth: 0,
    contributions: 0,
    withdrawals: 0,
    transfers: 0,
    endValue,
  };
}

function makeEquityResult(): AccountYearResult {
  return makeResult(EQUITY_ACCOUNT_ID, 0);
}

describe('ledger', () => {
  describe('emitJournalEntry', () => {
    it('credits the target account and records contribution (externalIn)', () => {
      const bank = createTestAccount({ id: 'acc-1', name: 'Bank', type: 'asset', initialValue: 100, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['acc-1', makeResult('acc-1', 100)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);
      const values = new Map([['acc-1', 100], [EQUITY_ACCOUNT_ID, 0]]);
      const journal: JournalEntry[] = [];

      emitJournalEntry(
        { debitAccountId: 'acc-1', creditAccountId: EQUITY_ACCOUNT_ID, amount: 50, label: 'salary', kind: 'externalIn' },
        journal, results, values, [bank], 2025, 'system',
      );

      expect(results.get('acc-1')!.endValue).toBe(150);
      expect(results.get('acc-1')!.contributions).toBe(50);
      expect(values.get('acc-1')).toBe(150);
      expect(journal).toHaveLength(1);
    });

    it('debits the target account and records withdrawal (externalOut)', () => {
      const bank = createTestAccount({ id: 'acc-1', name: 'Bank', type: 'asset', initialValue: 100, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['acc-1', makeResult('acc-1', 100)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);
      const values = new Map([['acc-1', 100], [EQUITY_ACCOUNT_ID, 0]]);
      const journal: JournalEntry[] = [];

      emitJournalEntry(
        { debitAccountId: EQUITY_ACCOUNT_ID, creditAccountId: 'acc-1', amount: 30, label: 'expense', kind: 'externalOut' },
        journal, results, values, [bank], 2025, 'system',
      );

      expect(results.get('acc-1')!.endValue).toBe(70);
      expect(results.get('acc-1')!.withdrawals).toBe(30);
    });

    it('appends a cashflowDetail on the account result', () => {
      const bank = createTestAccount({ id: 'acc-1', name: 'Bank', type: 'asset', initialValue: 100, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['acc-1', makeResult('acc-1', 100)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);
      const values = new Map([['acc-1', 100], [EQUITY_ACCOUNT_ID, 0]]);

      emitJournalEntry(
        { debitAccountId: 'acc-1', creditAccountId: EQUITY_ACCOUNT_ID, amount: 25, label: 'dividend', kind: 'synthetic', sourceAccountId: 'src-1', sourceAccountName: 'Shares' },
        [], results, values, [bank], 2025, 'system',
      );

      const details = results.get('acc-1')!.cashflowDetails!;
      expect(details).toHaveLength(1);
      expect(details[0].description).toBe('dividend');
      expect(details[0].amount).toBe(25);
      expect(details[0].type).toBe('contribution');
      expect(details[0].sourceAccountId).toBe('src-1');
    });

    it('calls onError and does NOT append entry when debit account is missing', () => {
      const results = new Map([[EQUITY_ACCOUNT_ID, makeEquityResult()]]);
      const values = new Map([[EQUITY_ACCOUNT_ID, 0]]);
      const journal: JournalEntry[] = [];
      const onError = vi.fn();

      emitJournalEntry(
        { debitAccountId: 'ghost-id', creditAccountId: EQUITY_ACCOUNT_ID, amount: 50, label: 'orphan flow', kind: 'externalIn' },
        journal, results, values, [], 2025, 'system', onError,
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toContain('ghost-id');
      expect(journal).toHaveLength(0);
    });

    it('does not call onError when no callback is provided and account is missing', () => {
      const results = new Map<string, AccountYearResult>();
      const values = new Map<string, number>();
      expect(() =>
        emitJournalEntry(
          { debitAccountId: 'ghost-id', creditAccountId: EQUITY_ACCOUNT_ID, amount: 50, label: 'test', kind: 'externalIn' },
          [], results, values, [], 2025, 'system',
        )
      ).not.toThrow();
    });
  });

  describe('applyDeferredJournalEntries', () => {
    it('applies all deferred entries in order and accumulates them', () => {
      const bank = createTestAccount({ id: 'bank', name: 'Bank', type: 'asset', initialValue: 1000, growthProfile: { type: 'fixed', rate: 0 } });
      const superAcc = createTestAccount({ id: 'super', name: 'Super', type: 'asset', initialValue: 500, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['bank', makeResult('bank', 1000)],
        ['super', makeResult('super', 500)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);
      const values = new Map([['bank', 1000], ['super', 500], [EQUITY_ACCOUNT_ID, 0]]);
      const journal: JournalEntry[] = [];
      const deferred: DeferredJournalEntry[] = [
        { debitAccountId: 'bank', creditAccountId: EQUITY_ACCOUNT_ID, amount: 200, label: 'salary', kind: 'externalIn' },
        { debitAccountId: EQUITY_ACCOUNT_ID, creditAccountId: 'bank', amount: 50, label: 'expense', kind: 'externalOut' },
        { debitAccountId: 'super', creditAccountId: EQUITY_ACCOUNT_ID, amount: 100, label: 'employer SG', kind: 'externalIn' },
      ];

      applyDeferredJournalEntries(deferred, journal, results, values, [bank, superAcc], 2025, 'system');

      expect(results.get('bank')!.endValue).toBe(1150);
      expect(results.get('super')!.endValue).toBe(600);
      expect(journal).toHaveLength(3);
    });

    it('calls onError for missing accounts and continues applying the rest', () => {
      const bank = createTestAccount({ id: 'bank', name: 'Bank', type: 'asset', initialValue: 1000, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['bank', makeResult('bank', 1000)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);
      const values = new Map([['bank', 1000], [EQUITY_ACCOUNT_ID, 0]]);
      const journal: JournalEntry[] = [];
      const onError = vi.fn();
      const deferred: DeferredJournalEntry[] = [
        { debitAccountId: 'missing', creditAccountId: EQUITY_ACCOUNT_ID, amount: 50, label: 'bad flow', kind: 'externalIn' },
        { debitAccountId: 'bank', creditAccountId: EQUITY_ACCOUNT_ID, amount: 200, label: 'salary', kind: 'externalIn' },
      ];

      applyDeferredJournalEntries(deferred, journal, results, values, [bank], 2025, 'system', onError);

      expect(onError).toHaveBeenCalledOnce();
      expect(results.get('bank')!.endValue).toBe(1200);
      expect(journal).toHaveLength(1);
    });
  });

  describe('checkConservation', () => {
    it('passes when there are no entries', () => {
      const result = checkConservation([], new Map(), [], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0);
    });

    it('passes when internalTransfer entries are perfectly balanced', () => {
      const pension = createTestAccount({ id: 'pension', name: 'Pension', type: 'asset', initialValue: 200_000, growthProfile: { type: 'fixed', rate: 0 } });
      const cash = createTestAccount({ id: 'cash', name: 'Cash', type: 'asset', initialValue: 10_000, growthProfile: { type: 'fixed', rate: 0 } });

      const results = new Map([
        ['pension', makeResult('pension', 200_000, 170_000)],
        ['cash', makeResult('cash', 10_000, 40_000)],
      ]);

      const entries: JournalEntry[] = [
        {
          seq: 1, year: 2025, userId: 'system', timestamp: '',
          debitAccountId: 'cash', debitAccountName: 'Cash',
          creditAccountId: 'pension', creditAccountName: 'Pension',
          amount: 30_000, label: 'pension drawdown', kind: 'internalTransfer',
        },
      ];

      const result = checkConservation(entries, results, [pension, cash], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0);
    });

    it('reports equityBalance from equity account result', () => {
      const bank = createTestAccount({ id: 'bank', name: 'Bank', type: 'asset', initialValue: 0, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['bank', makeResult('bank', 0, 120_000)],
        [EQUITY_ACCOUNT_ID, { ...makeEquityResult(), endValue: 120_000 }],
      ]);

      const entries: JournalEntry[] = [
        {
          seq: 1, year: 2025, userId: 'system', timestamp: '',
          debitAccountId: 'bank', debitAccountName: 'Bank',
          creditAccountId: EQUITY_ACCOUNT_ID, creditAccountName: 'Equity',
          amount: 120_000, label: 'salary', kind: 'externalIn',
        },
      ];

      const result = checkConservation(entries, results, [bank], 2025);
      expect(result.passed).toBe(true);
      expect(result.equityBalance).toBe(120_000);
    });

    it('internalTransfer entries always have zero transfer imbalance in the two-sided system', () => {
      const pension = createTestAccount({ id: 'pension', name: 'Pension', type: 'asset', initialValue: 200_000, growthProfile: { type: 'fixed', rate: 0 } });
      const cash = createTestAccount({ id: 'cash', name: 'Cash', type: 'asset', initialValue: 10_000, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['pension', makeResult('pension', 200_000, 170_000)],
        ['cash', makeResult('cash', 10_000, 40_000)],
      ]);

      const singleEntry: JournalEntry[] = [
        {
          seq: 1, year: 2025, userId: 'system', timestamp: '',
          debitAccountId: 'cash', debitAccountName: 'Cash',
          creditAccountId: 'pension', creditAccountName: 'Pension',
          amount: 30_000, label: 'pension drawdown', kind: 'internalTransfer',
        },
      ];

      const result = checkConservation(singleEntry, results, [pension, cash], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0);
    });

    it('does not count externalIn/externalOut/synthetic in the transfer balance', () => {
      const bank = createTestAccount({ id: 'bank', name: 'Bank', type: 'asset', initialValue: 100, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([
        ['bank', makeResult('bank', 100, 180)],
        [EQUITY_ACCOUNT_ID, makeEquityResult()],
      ]);

      const entries: JournalEntry[] = [
        { seq: 1, year: 2025, userId: 'system', timestamp: '', debitAccountId: 'bank', debitAccountName: 'Bank', creditAccountId: EQUITY_ACCOUNT_ID, creditAccountName: 'Equity', amount: 200, label: 'salary', kind: 'externalIn' },
        { seq: 2, year: 2025, userId: 'system', timestamp: '', debitAccountId: EQUITY_ACCOUNT_ID, debitAccountName: 'Equity', creditAccountId: 'bank', creditAccountName: 'Bank', amount: 50, label: 'tax', kind: 'externalOut' },
        { seq: 3, year: 2025, userId: 'system', timestamp: '', debitAccountId: 'bank', debitAccountName: 'Bank', creditAccountId: EQUITY_ACCOUNT_ID, creditAccountName: 'Equity', amount: 30, label: 'growth', kind: 'synthetic' },
      ];

      const result = checkConservation(entries, results, [bank], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0);
    });
  });
});
