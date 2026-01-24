import { describe, it, expect } from 'vitest';
import { calculateForecast } from './forecast';
import type { Account, Assumptions, Person, Event } from '../schemas';

describe('calculateForecast', () => {
  const defaultAssumptions: Assumptions = {
    cpi: { baseValue: 0.03 },
    investmentGrowth: { baseValue: 0.05 },
    superGrowth: { baseValue: 0.07 },
  };

  const defaultPerson: Person = {
    id: 'person-1111-1111-1111-111111111111',
    name: 'Test Person',
    birthYear: 1980,
  };

  describe('account end behavior', () => {
    it('sets income to zero after end year with zero behavior', () => {
      const incomeAccount: Account = {
        id: 'income-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'zero',
      };

      const result = calculateForecast({
        accounts: [incomeAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [],
        startYear: 2025,
        endYear: 2030,
      });

      const year2027 = result.years.find((y) => y.year === 2027);
      const year2028 = result.years.find((y) => y.year === 2028);
      const year2029 = result.years.find((y) => y.year === 2029);

      expect(year2027).toBeDefined();
      expect(year2028).toBeDefined();
      expect(year2029).toBeDefined();

      const account2027 = year2027!.accounts.find((a) => a.accountId === incomeAccount.id);
      const account2028 = year2028!.accounts.find((a) => a.accountId === incomeAccount.id);
      const account2029 = year2029!.accounts.find((a) => a.accountId === incomeAccount.id);

      expect(account2027!.endValue).toBeGreaterThan(0);
      expect(account2028!.endValue).toBe(0);
      expect(account2029?.endValue ?? 0).toBe(0);
    });

    it('transfers asset value to destination account in the same year', () => {
      const houseAccount: Account = {
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 1000000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'transfer',
        transferToAccountId: 'cash-1111-1111-1111-111111111111',
      };

      const cashAccount: Account = {
        id: 'cash-1111-1111-1111-111111111111',
        name: 'Cash',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      };

      const result = calculateForecast({
        accounts: [houseAccount, cashAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [],
        startYear: 2025,
        endYear: 2030,
      });

      const year2026 = result.years.find((y) => y.year === 2026);
      const year2027 = result.years.find((y) => y.year === 2027);
      const year2028 = result.years.find((y) => y.year === 2028);

      expect(year2026).toBeDefined();
      expect(year2027).toBeDefined();
      expect(year2028).toBeDefined();

      const house2027 = year2027!.accounts.find((a) => a.accountId === houseAccount.id);
      const cash2027 = year2027!.accounts.find((a) => a.accountId === cashAccount.id);
      const cash2026 = year2026!.accounts.find((a) => a.accountId === cashAccount.id);

      expect(house2027!.transfers).toBeLessThan(0);
      expect(house2027!.endValue).toBe(0);
      
      const houseValueBeforeSale = Math.abs(house2027!.transfers);
      expect(cash2027!.contributions).toBe(houseValueBeforeSale);
      expect(cash2027!.endValue).toBe(cash2026!.endValue * 1.02 + houseValueBeforeSale);
    });

    it('holds value after end year with hold behavior and includes in totals', () => {
      const expenseAccount: Account = {
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Insurance',
        type: 'expense',
        initialValue: 5000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'hold',
      };

      const result = calculateForecast({
        accounts: [expenseAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [],
        startYear: 2025,
        endYear: 2030,
      });

      const year2027 = result.years.find((y) => y.year === 2027);
      const year2028 = result.years.find((y) => y.year === 2028);
      const year2029 = result.years.find((y) => y.year === 2029);

      expect(year2027).toBeDefined();
      expect(year2028).toBeDefined();
      expect(year2029).toBeDefined();

      const account2027 = year2027!.accounts.find((a) => a.accountId === expenseAccount.id);
      const account2028 = year2028!.accounts.find((a) => a.accountId === expenseAccount.id);
      const account2029 = year2029!.accounts.find((a) => a.accountId === expenseAccount.id);

      const valueAt2027 = account2027!.endValue;
      expect(valueAt2027).toBeGreaterThan(5000);
      expect(account2028!.endValue).toBe(valueAt2027);
      expect(account2029!.endValue).toBe(valueAt2027);

      expect(year2028!.totalExpenses).toBe(valueAt2027);
      expect(year2029!.totalExpenses).toBe(valueAt2027);
    });

    it('income deposits to specified asset account', () => {
      const salaryAccount: Account = {
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        depositsToAccountId: 'bank-1111-1111-1111-111111111111',
      };

      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      };

      const result = calculateForecast({
        accounts: [salaryAccount, bankAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [],
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find((y) => y.year === 2025);
      expect(year2025).toBeDefined();

      const bank2025 = year2025!.accounts.find((a) => a.accountId === bankAccount.id);
      const salary2025 = year2025!.accounts.find((a) => a.accountId === salaryAccount.id);
      expect(bank2025!.contributions).toBe(salary2025!.endValue);
      expect(bank2025!.endValue).toBe(10000 * 1.02 + salary2025!.endValue);
    });

    it('expense withdraws from specified asset account', () => {
      const livingCostsAccount: Account = {
        id: 'living-1111-1111-1111-111111111111',
        name: 'Living Costs',
        type: 'expense',
        initialValue: 60000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        fundedByAccountId: 'bank-1111-1111-1111-111111111111',
      };

      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      };

      const result = calculateForecast({
        accounts: [livingCostsAccount, bankAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [],
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find((y) => y.year === 2025);
      expect(year2025).toBeDefined();

      const bank2025 = year2025!.accounts.find((a) => a.accountId === bankAccount.id);
      const living2025 = year2025!.accounts.find((a) => a.accountId === livingCostsAccount.id);
      expect(bank2025!.withdrawals).toBe(living2025!.endValue);
      expect(bank2025!.endValue).toBe(100000 * 1.02 - living2025!.endValue);
    });

    it('transfer event moves money between accounts', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 600000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      };

      const houseAccount: Account = {
        id: 'house-1111-1111-1111-111111111111',
        name: 'Investment Property',
        type: 'asset',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0.05 },
      };

      const buyHouseEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2026,
        type: 'transfer',
        description: 'Buy investment property',
        amount: 500000,
        sourceAccountId: bankAccount.id,
        targetAccountId: houseAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, houseAccount],
        assumptions: defaultAssumptions,
        events: [buyHouseEvent],
        persons: [],
        startYear: 2025,
        endYear: 2027,
      });

      const year2026 = result.years.find((y) => y.year === 2026);
      expect(year2026).toBeDefined();

      const bank2026 = year2026!.accounts.find((a) => a.accountId === bankAccount.id);
      const house2026 = year2026!.accounts.find((a) => a.accountId === houseAccount.id);

      expect(bank2026!.transfers).toBe(-500000);
      expect(house2026!.transfers).toBe(500000);
      expect(house2026!.endValue).toBe(500000 * 1.05);
    });

    it('respects age-based end condition', () => {
      const superAccount: Account = {
        id: 'super-1111-1111-1111-111111111111',
        name: 'Superannuation',
        type: 'asset',
        owner: defaultPerson.id,
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.07 },
        endCondition: { type: 'age', personId: defaultPerson.id, age: 67 },
        endBehavior: 'zero',
      };

      const endYear = defaultPerson.birthYear + 67;

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        events: [],
        persons: [defaultPerson],
        startYear: endYear - 2,
        endYear: endYear + 2,
      });

      const beforeEnd = result.years.find((y) => y.year === endYear);
      const afterEnd = result.years.find((y) => y.year === endYear + 1);

      expect(beforeEnd).toBeDefined();
      expect(afterEnd).toBeDefined();

      const accountBeforeEnd = beforeEnd!.accounts.find((a) => a.accountId === superAccount.id);
      const accountAfterEnd = afterEnd!.accounts.find((a) => a.accountId === superAccount.id);

      expect(accountBeforeEnd!.endValue).toBeGreaterThan(0);
      expect(accountAfterEnd!.endValue).toBe(0);
    });
  });
});
