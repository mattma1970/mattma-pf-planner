import { describe, it, expect } from 'vitest';
import { isAccountActive, projectAccountValue, handleAccountTransfer } from './accounts';
import type { Account, ResolvedAssumptions } from '../schemas';
import { samplePersons, sampleResolvedAssumptions } from '../test/fixtures';

describe('isAccountActive', () => {
  const baseAccount: Account = {
    id: 'test1111-1111-1111-1111-111111111111',
    name: 'Test Account',
    type: 'asset',
    initialValue: 10000,
    growthProfile: { type: 'fixed', rate: 0.03 },
  };

  it('returns true when no conditions are set (always active)', () => {
    expect(isAccountActive(baseAccount, 2024, [])).toBe(true);
    expect(isAccountActive(baseAccount, 2050, [])).toBe(true);
  });

  it('respects year-based startCondition', () => {
    const account: Account = {
      ...baseAccount,
      startCondition: { type: 'year', year: 2025 },
    };
    expect(isAccountActive(account, 2024, [])).toBe(false);
    expect(isAccountActive(account, 2025, [])).toBe(true);
    expect(isAccountActive(account, 2026, [])).toBe(true);
  });

  it('respects year-based endCondition', () => {
    const account: Account = {
      ...baseAccount,
      endCondition: { type: 'year', year: 2030 },
    };
    expect(isAccountActive(account, 2029, [])).toBe(true);
    expect(isAccountActive(account, 2030, [])).toBe(true);
    expect(isAccountActive(account, 2031, [])).toBe(false);
  });

  it('respects age-based conditions with person birthYear', () => {
    const alice = samplePersons[0];
    const account: Account = {
      ...baseAccount,
      owner: alice.id,
      startCondition: { type: 'age', personId: alice.id, age: 60 },
      endCondition: { type: 'age', personId: alice.id, age: 70 },
    };

    const startYear = alice.birthYear + 60;
    const endYear = alice.birthYear + 70;

    expect(isAccountActive(account, startYear - 1, samplePersons)).toBe(false);
    expect(isAccountActive(account, startYear, samplePersons)).toBe(true);
    expect(isAccountActive(account, endYear, samplePersons)).toBe(true);
    expect(isAccountActive(account, endYear + 1, samplePersons)).toBe(false);
  });
});

describe('projectAccountValue', () => {
  const assumptions: ResolvedAssumptions = sampleResolvedAssumptions;

  it('applies fixed growth rate correctly', () => {
    const account: Account = {
      id: 'test2222-2222-2222-2222-222222222222',
      name: 'Fixed Growth Account',
      type: 'asset',
      initialValue: 100000,
      growthProfile: { type: 'fixed', rate: 0.05 },
    };

    const result = projectAccountValue(account, 2024, 100000, assumptions, 1);
    expect(result).toBe(105000);
  });

  it('applies cpiLinked growth with add operation', () => {
    const account: Account = {
      id: 'test3333-3333-3333-3333-333333333333',
      name: 'CPI Linked Account',
      type: 'expense',
      initialValue: 50000,
      growthProfile: { type: 'cpiLinked', operation: 'add', value: 0.01 },
    };

    const expectedRate = assumptions.cpi + 0.01;
    const result = projectAccountValue(account, 2024, 50000, assumptions, 1);
    expect(result).toBe(50000 * (1 + expectedRate));
  });

  it('applies cpiLinked growth with subtract operation', () => {
    const account: Account = {
      id: 'test3333-3333-3333-3333-333333333334',
      name: 'CPI Linked Subtract',
      type: 'expense',
      initialValue: 50000,
      growthProfile: { type: 'cpiLinked', operation: 'subtract', value: 0.01 },
    };

    const expectedRate = assumptions.cpi - 0.01;
    const result = projectAccountValue(account, 2024, 50000, assumptions, 1);
    expect(result).toBe(50000 * (1 + expectedRate));
  });

  it('applies cpiLinked growth with multiply operation', () => {
    const account: Account = {
      id: 'test3333-3333-3333-3333-333333333335',
      name: 'CPI Linked Multiply',
      type: 'expense',
      initialValue: 50000,
      growthProfile: { type: 'cpiLinked', operation: 'multiply', value: 0.5 },
    };

    const expectedRate = assumptions.cpi * 0.5;
    const result = projectAccountValue(account, 2024, 50000, assumptions, 1);
    expect(result).toBe(50000 * (1 + expectedRate));
  });

  it('applies increasing growth rate over time', () => {
    const account: Account = {
      id: 'test4444-4444-4444-4444-444444444444',
      name: 'Increasing Growth Account',
      type: 'asset',
      initialValue: 100000,
      growthProfile: { type: 'increasing', rate: 0.05, changePerYear: 0.01 },
    };

    const year1 = projectAccountValue(account, 2024, 100000, assumptions, 1);
    expect(year1).toBe(100000 * (1 + 0.05));

    const year3 = projectAccountValue(account, 2026, 100000, assumptions, 3);
    const expectedRate = 0.05 + 0.01 * (3 - 1);
    expect(year3).toBe(100000 * (1 + expectedRate));
  });

  it('applies decreasing growth rate over time, flooring at 0', () => {
    const account: Account = {
      id: 'test5555-5555-5555-5555-555555555555',
      name: 'Decreasing Growth Account',
      type: 'asset',
      initialValue: 100000,
      growthProfile: { type: 'decreasing', rate: 0.03, changePerYear: 0.01 },
    };

    const year1 = projectAccountValue(account, 2024, 100000, assumptions, 1);
    expect(year1).toBe(100000 * (1 + 0.03));

    const year3 = projectAccountValue(account, 2026, 100000, assumptions, 3);
    const expectedRate = Math.max(0, 0.03 - 0.01 * (3 - 1));
    expect(year3).toBe(100000 * (1 + expectedRate));

    const year10 = projectAccountValue(account, 2033, 100000, assumptions, 10);
    expect(year10).toBe(100000 * (1 + 0));
  });
});

describe('handleAccountTransfer', () => {
  const alice = samplePersons[0];

  const accountWithTransfer: Account = {
    id: 'test6666-6666-6666-6666-666666666666',
    name: 'Transfer Account',
    type: 'asset',
    owner: alice.id,
    initialValue: 100000,
    growthProfile: { type: 'fixed', rate: 0.05 },
    endCondition: { type: 'year', year: 2030 },
    endBehavior: 'transfer',
    transferToAccountId: 'dest1111-1111-1111-1111-111111111111',
  };

  it('returns isTransferYear: false when not transfer year', () => {
    const result = handleAccountTransfer(accountWithTransfer, 2029, samplePersons, 150000);
    expect(result.isTransferYear).toBe(false);
    expect(result.amount).toBe(0);
  });

  it('returns transfer details when it is transfer year', () => {
    const result = handleAccountTransfer(accountWithTransfer, 2030, samplePersons, 150000);
    expect(result.isTransferYear).toBe(true);
    expect(result.amount).toBe(150000);
    expect(result.destinationId).toBe('dest1111-1111-1111-1111-111111111111');
  });

  it('handles full transfer amount', () => {
    const result = handleAccountTransfer(accountWithTransfer, 2030, samplePersons, 100000);
    expect(result.isTransferYear).toBe(true);
    expect(result.amount).toBe(100000);
  });

  it('returns no transfer when account has no endBehavior set to transfer', () => {
    const accountNoTransfer: Account = {
      id: 'test7777-7777-7777-7777-777777777777',
      name: 'No Transfer Account',
      type: 'asset',
      initialValue: 100000,
      growthProfile: { type: 'fixed', rate: 0.03 },
      endCondition: { type: 'year', year: 2030 },
      endBehavior: 'zero',
    };

    const result = handleAccountTransfer(accountNoTransfer, 2030, samplePersons, 100000);
    expect(result.isTransferYear).toBe(false);
    expect(result.amount).toBe(0);
  });
});
