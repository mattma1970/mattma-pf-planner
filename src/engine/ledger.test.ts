import { describe, it, expect, vi } from 'vitest';
import { emitLedgerEntry, applyDeferredLedger, checkConservation, type LedgerEntry } from './ledger';
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

describe('ledger', () => {
  describe('emitLedgerEntry', () => {
    it('credits the target account and records contribution', () => {
      const results = new Map([['acc-1', makeResult('acc-1', 100)]]);
      const values = new Map([['acc-1', 100]]);
      const accumulated: LedgerEntry[] = [];

      emitLedgerEntry(
        { accountId: 'acc-1', amount: 50, delta: 'credit', kind: 'externalIn', label: 'salary' },
        accumulated, results, values,
      );

      expect(results.get('acc-1')!.endValue).toBe(150);
      expect(results.get('acc-1')!.contributions).toBe(50);
      expect(values.get('acc-1')).toBe(150);
      expect(accumulated).toHaveLength(1);
    });

    it('debits the target account and records withdrawal', () => {
      const results = new Map([['acc-1', makeResult('acc-1', 100)]]);
      const values = new Map([['acc-1', 100]]);
      const accumulated: LedgerEntry[] = [];

      emitLedgerEntry(
        { accountId: 'acc-1', amount: 30, delta: 'debit', kind: 'externalOut', label: 'expense' },
        accumulated, results, values,
      );

      expect(results.get('acc-1')!.endValue).toBe(70);
      expect(results.get('acc-1')!.withdrawals).toBe(30);
    });

    it('appends a cashflowDetail on the account result', () => {
      const results = new Map([['acc-1', makeResult('acc-1', 100)]]);
      const values = new Map([['acc-1', 100]]);

      emitLedgerEntry(
        { accountId: 'acc-1', amount: 25, delta: 'credit', kind: 'synthetic', label: 'dividend', sourceAccountId: 'src-1', sourceAccountName: 'Shares' },
        [], results, values,
      );

      const details = results.get('acc-1')!.cashflowDetails!;
      expect(details).toHaveLength(1);
      expect(details[0].description).toBe('dividend');
      expect(details[0].amount).toBe(25);
      expect(details[0].type).toBe('contribution');
      expect(details[0].sourceAccountId).toBe('src-1');
    });

    it('calls onError and does NOT append entry when account is missing', () => {
      const results = new Map<string, AccountYearResult>();
      const values = new Map<string, number>();
      const accumulated: LedgerEntry[] = [];
      const onError = vi.fn();

      emitLedgerEntry(
        { accountId: 'ghost-id', amount: 50, delta: 'credit', kind: 'externalIn', label: 'orphan flow' },
        accumulated, results, values, onError,
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0]).toContain('ghost-id');
      expect(accumulated).toHaveLength(0);
    });

    it('does not call onError when no callback is provided and account is missing', () => {
      const results = new Map<string, AccountYearResult>();
      const values = new Map<string, number>();
      // Should not throw
      expect(() =>
        emitLedgerEntry(
          { accountId: 'ghost-id', amount: 50, delta: 'credit', kind: 'externalIn', label: 'test' },
          [], results, values,
        )
      ).not.toThrow();
    });
  });

  describe('applyDeferredLedger', () => {
    it('applies all deferred entries in order and accumulates them', () => {
      const results = new Map([
        ['bank', makeResult('bank', 1000)],
        ['super', makeResult('super', 500)],
      ]);
      const values = new Map([['bank', 1000], ['super', 500]]);
      const accumulated: LedgerEntry[] = [];
      const deferred: LedgerEntry[] = [
        { accountId: 'bank', amount: 200, delta: 'credit', kind: 'externalIn', label: 'salary' },
        { accountId: 'bank', amount: 50,  delta: 'debit',  kind: 'externalOut', label: 'expense' },
        { accountId: 'super', amount: 100, delta: 'credit', kind: 'externalIn', label: 'employer SG' },
      ];

      applyDeferredLedger(deferred, accumulated, results, values);

      expect(results.get('bank')!.endValue).toBe(1150);   // +200 −50
      expect(results.get('super')!.endValue).toBe(600);    // +100
      expect(accumulated).toHaveLength(3);
    });

    it('calls onError for missing accounts and continues applying the rest', () => {
      const results = new Map([['bank', makeResult('bank', 1000)]]);
      const values = new Map([['bank', 1000]]);
      const accumulated: LedgerEntry[] = [];
      const onError = vi.fn();
      const deferred: LedgerEntry[] = [
        { accountId: 'missing', amount: 50, delta: 'credit', kind: 'externalIn', label: 'bad flow' },
        { accountId: 'bank',    amount: 200, delta: 'credit', kind: 'externalIn', label: 'salary' },
      ];

      applyDeferredLedger(deferred, accumulated, results, values, onError);

      expect(onError).toHaveBeenCalledOnce();
      expect(results.get('bank')!.endValue).toBe(1200); // good entry still applied
      expect(accumulated).toHaveLength(1);              // only valid entry recorded
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
      const cash    = createTestAccount({ id: 'cash',    name: 'Cash',    type: 'asset', initialValue: 10_000,  growthProfile: { type: 'fixed', rate: 0 } });

      const results = new Map([
        ['pension', makeResult('pension', 200_000, 170_000)], // debited 30k
        ['cash',    makeResult('cash',    10_000,  40_000)],  // credited 30k
      ]);

      const entries: LedgerEntry[] = [
        { accountId: 'pension', amount: 30_000, delta: 'debit',  kind: 'internalTransfer', label: 'pension drawdown debit' },
        { accountId: 'cash',    amount: 30_000, delta: 'credit', kind: 'internalTransfer', label: 'pension drawdown credit' },
      ];

      const result = checkConservation(entries, results, [pension, cash], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0);
    });

    it('fails when an internalTransfer debit has no matching credit (the pension drawdown bug)', () => {
      const pension = createTestAccount({ id: 'pension', name: 'Pension', type: 'asset', initialValue: 200_000, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([['pension', makeResult('pension', 200_000, 200_000)]]);

      // Only debit emitted — credit side (cash account) missing
      const entries: LedgerEntry[] = [
        { accountId: 'pension', amount: 30_000, delta: 'debit', kind: 'internalTransfer', label: 'orphaned debit' },
      ];

      const result = checkConservation(entries, results, [pension], 2025);
      expect(result.passed).toBe(false);
      expect(result.transferImbalance).toBe(-30_000);
    });

    it('fails when an internalTransfer credit has no matching debit', () => {
      const cash = createTestAccount({ id: 'cash', name: 'Cash', type: 'asset', initialValue: 0, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([['cash', makeResult('cash', 0, 30_000)]]);

      // Only credit emitted — debit side missing (money created from nothing)
      const entries: LedgerEntry[] = [
        { accountId: 'cash', amount: 30_000, delta: 'credit', kind: 'internalTransfer', label: 'orphaned credit' },
      ];

      const result = checkConservation(entries, results, [cash], 2025);
      expect(result.passed).toBe(false);
      expect(result.transferImbalance).toBe(30_000);
    });

    it('does not count externalIn/externalOut/synthetic in the transfer balance', () => {
      const bank = createTestAccount({ id: 'bank', name: 'Bank', type: 'asset', initialValue: 100, growthProfile: { type: 'fixed', rate: 0 } });
      const results = new Map([['bank', makeResult('bank', 100, 180)]]);

      const entries: LedgerEntry[] = [
        { accountId: 'bank', amount: 200, delta: 'credit', kind: 'externalIn',  label: 'salary' },
        { accountId: 'bank', amount: 50,  delta: 'debit',  kind: 'externalOut', label: 'tax' },
        { accountId: 'bank', amount: 30,  delta: 'debit',  kind: 'synthetic',   label: 'revaluation down' },
      ];

      const result = checkConservation(entries, results, [bank], 2025);
      expect(result.passed).toBe(true);
      expect(result.transferImbalance).toBe(0); // no internalTransfer entries
    });
  });
});
