import { describe, it, expect } from 'vitest';
import { calculateForecast } from './forecast';
import type { Account, Assumptions, Epoch, Person, Event, Settings } from '../schemas';
import { defaultSettings } from '../schemas';

describe('calculateForecast', () => {
  const defaultAssumptions: Assumptions = {
    cpi: { baseValue: 0.03 },
    investmentGrowth: { baseValue: 0.05 },
    superGrowth: { baseValue: 0.07 },
  };

  const testSettings: Settings = { ...defaultSettings };

  const defaultEpochs: Epoch[] = [
    {
      id: 'epoch-1111-1111-1111-111111111111',
      name: 'Default',
      startYear: 2020,
      endYear: 2100,
      order: 0,
    },
  ];

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
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [buyHouseEvent],
        persons: [],
        settings: testSettings,
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
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
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

  describe('tax funding', () => {
    it('deducts tax from the designated funding account', () => {
      const salaryAccount: Account = {
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const settingsWithTaxFunding: Settings = {
        ...testSettings,
        defaultTaxFundingAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [salaryAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: settingsWithTaxFunding,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      expect(year2025.taxPayable).toBeGreaterThan(0);

      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id);
      expect(bankResult).toBeDefined();
      expect(bankResult!.withdrawals).toBe(year2025.taxPayable);
      expect(bankResult!.endValue).toBe(50000 - year2025.taxPayable);
    });

    it('does not deduct tax when no funding account is configured', () => {
      const salaryAccount: Account = {
        id: 'salary-2222-2222-2222-222222222222',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const bankAccount: Account = {
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const result = calculateForecast({
        accounts: [salaryAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      expect(year2025.taxPayable).toBeGreaterThan(0);

      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id);
      expect(bankResult).toBeDefined();
      expect(bankResult!.withdrawals).toBe(0);
      expect(bankResult!.endValue).toBe(50000);
    });

    it('generates tax aggregations grouped by funding account', () => {
      const salaryAccount: Account = {
        id: 'salary-3333-3333-3333-333333333333',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const bankAccount: Account = {
        id: 'bank-3333-3333-3333-333333333333',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const settingsWithTaxFunding: Settings = {
        ...testSettings,
        defaultTaxFundingAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [salaryAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: settingsWithTaxFunding,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      expect(year2025.taxEvents.length).toBe(1);
      expect(year2025.taxEvents[0].type).toBe('incomeTax');
      expect(year2025.taxEvents[0].assessableAmount).toBe(100000);
      
      expect(year2025.taxAggregations.length).toBe(1);
      expect(year2025.taxAggregations[0].fundedFromAccountId).toBe(bankAccount.id);
      expect(year2025.taxAggregations[0].taxSchedule).toBe('marginalRates');
      expect(year2025.taxAggregations[0].calculatedTax).toBe(year2025.taxPayable);
    });
  });

  describe('growth calculation method', () => {
    it('uses opening balance method by default', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.10 }, // 10% for easy math
      };

      const houseAccount: Account = {
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'transfer',
        transferToAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, houseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
        startYear: 2025,
        endYear: 2025,
      });

      const bank2025 = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Opening balance method: growth on $100k only, then add $500k
      // Growth = $100k * 0.10 = $10k
      // End = $100k + $10k + $500k = $610k
      expect(bank2025.growth).toBeCloseTo(10000, 2);
      expect(bank2025.endValue).toBeCloseTo(610000, 2);
    });

    it('uses average balance method when configured', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.10 }, // 10% for easy math
      };

      const houseAccount: Account = {
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'transfer',
        transferToAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, houseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: { ...testSettings, growthCalculationMethod: 'averageBalance' },
        startYear: 2025,
        endYear: 2025,
      });

      const bank2025 = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Average balance method: growth on ($100k + 0.5 * $500k) = $350k
      // Growth = $350k * 0.10 = $35k
      // End = $350k + growth + other half of transfer = $350k + $35k + $250k = $635k
      expect(bank2025.growth).toBeCloseTo(35000, 2);
      expect(bank2025.endValue).toBeCloseTo(635000, 2);
    });
  });

  describe('auto-topup', () => {
    it('tops up account when balance falls below threshold', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
        autoTopup: {
          enabled: true,
          threshold: 0,
          fromAccountId: 'pension-1111-1111-1111-111111111111',
        },
      };

      const pensionAccount: Account = {
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const expenseAccount: Account = {
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000, // More than bank balance
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, pensionAccount, expenseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const bank2025 = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const pension2025 = result.years[0].accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Bank: $10k - $50k expense = -$40k, then topped up to $0
      // Topup amount = $40k
      expect(bank2025.endValue).toBe(0);
      expect(bank2025.contributions).toBe(40000); // Topup amount
      
      // Pension: $500k - $40k topup = $460k
      expect(pension2025.endValue).toBe(460000);
      expect(pension2025.withdrawals).toBe(40000);
    });

    it('tops up to target balance when specified', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
        autoTopup: {
          enabled: true,
          threshold: 0,
          fromAccountId: 'pension-1111-1111-1111-111111111111',
          targetBalance: 20000, // Top up to $20k when below $0
        },
      };

      const pensionAccount: Account = {
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const expenseAccount: Account = {
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, pensionAccount, expenseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const bank2025 = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const pension2025 = result.years[0].accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Bank: $10k - $50k = -$40k, topped up to $20k target
      // Topup amount = $20k - (-$40k) = $60k
      expect(bank2025.endValue).toBe(20000);
      expect(bank2025.contributions).toBe(60000);
      
      // Pension: $500k - $60k = $440k
      expect(pension2025.endValue).toBe(440000);
    });

    it('allows source account to go negative if insufficient funds', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
        autoTopup: {
          enabled: true,
          threshold: 0,
          fromAccountId: 'pension-1111-1111-1111-111111111111',
        },
      };

      const pensionAccount: Account = {
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 20000, // Only $20k, not enough for $40k topup
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const expenseAccount: Account = {
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, pensionAccount, expenseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const bank2025 = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const pension2025 = result.years[0].accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Bank topped up to $0 (topup = $40k)
      expect(bank2025.endValue).toBe(0);
      
      // Pension goes negative: $20k - $40k = -$20k
      expect(pension2025.endValue).toBe(-20000);
    });
  });

  describe('liability calculations', () => {
    it('accrues interest on liability balance', () => {
      const bankAccount: Account = {
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-1111-1111-1111-111111111111',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06, // 6% interest
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Interest only: $500k * 6% = $30k interest
      expect(mortResult.growth).toBe(30000); // Interest accrued
      expect(mortResult.endValue).toBe(500000); // Balance unchanged (interest only)
      
      // Bank pays $30k interest
      expect(bankResult.withdrawals).toBe(30000);
      expect(bankResult.endValue).toBe(70000); // $100k - $30k
    });

    it('reduces principal with P&I payments', () => {
      const bankAccount: Account = {
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-2222-2222-2222-222222222222',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.05, // 5% interest
        paymentType: 'principalAndInterest',
        annualPayment: 25000, // Fixed payment
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      
      // Interest: $100k * 5% = $5k
      // Principal reduction: $25k - $5k = $20k
      // End value: $100k + $5k - $25k = $80k (or $100k - $20k principal = $80k)
      expect(mortResult.growth).toBe(5000); // Interest
      expect(mortResult.withdrawals).toBe(20000); // Principal paid
      expect(mortResult.endValue).toBe(80000); // $100k + $5k interest - $25k payment
    });

    it('applies offset account to reduce interest', () => {
      const bankAccount: Account = {
        id: 'bank-3333-3333-3333-333333333333',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const offsetAccount: Account = {
        id: 'offset-3333-3333-3333-333333333333',
        name: 'Offset',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-3333-3333-3333-333333333333',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06, // 6% interest
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, offsetAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      
      // Effective balance: $500k - $200k = $300k
      // Interest: $300k * 6% = $18k (not $30k)
      expect(mortResult.growth).toBe(18000);
    });

    it('calculates correct payment with offset account and auto-calculate', () => {
      const bankAccount: Account = {
        id: 'bank-6666-6666-6666-666666666666',
        name: 'Bank',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const offsetAccount: Account = {
        id: 'offset-6666-6666-6666-666666666666',
        name: 'Offset',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-6666-6666-6666-666666666666',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06, // 6% interest
        paymentType: 'principalAndInterest',
        calculatePayment: true,
        endCondition: { type: 'year', year: 2027 }, // 3 year loan
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, offsetAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Effective balance: $300k - $200k = $100k
      // Interest: $100k * 6% = $6k
      expect(mortResult.growth).toBe(6000);
      
      // Payment should be: principal/years + interest = $100k + $6k = $106k
      // Principal portion: $300k / 3 = $100k
      // Total payment: $100k + $6k = $106k
      const expectedPayment = 100000 + 6000;
      expect(bankResult.withdrawals).toBe(expectedPayment);
      
      // Mortgage balance after: $300k + $6k interest - $106k payment = $200k
      expect(mortResult.endValue).toBe(200000);
    });

    it('bank withdrawals match liability payment exactly', () => {
      const bankAccount: Account = {
        id: 'bank-7777-7777-7777-777777777777',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-7777-7777-7777-777777777777',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.05, // 5% interest
        paymentType: 'principalAndInterest',
        annualPayment: 30000, // Fixed $30k payment
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Interest: $100k * 5% = $5k
      // Payment: $30k
      // Principal reduction: $30k - $5k = $25k
      expect(mortResult.growth).toBe(5000); // Interest accrued
      expect(mortResult.withdrawals).toBe(25000); // Principal paid
      
      // Bank withdrawal should equal the total payment (interest + principal)
      expect(bankResult.withdrawals).toBe(30000);
      
      // Verify the math reconciles:
      // Mortgage: $100k + $5k interest - $30k payment = $75k
      expect(mortResult.endValue).toBe(75000);
      // Bank: $200k - $30k payment = $170k
      expect(bankResult.endValue).toBe(170000);
    });

    it('liability growthProfile is ignored (interest handled separately)', () => {
      // This test ensures liabilities don't get double-processed:
      // growthProfile should be ignored since interest is calculated separately
      const bankAccount: Account = {
        id: 'bank-9999-9999-9999-999999999999',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-9999-9999-9999-999999999999',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 }, // This should be IGNORED
        interestRate: 0.06, // Only this should be used
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Interest should only be 6% of $100k = $6k
      // NOT 6% + 3% = 9%
      expect(mortResult.growth).toBe(6000);
      
      // Payment should only be $6k (interest only)
      expect(bankResult.withdrawals).toBe(6000);
      
      // Balance should remain $100k (interest-only loan)
      expect(mortResult.endValue).toBe(100000);
    });

    it('offset account larger than mortgage results in zero interest', () => {
      const bankAccount: Account = {
        id: 'bank-8888-8888-8888-888888888888',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const offsetAccount: Account = {
        id: 'offset-8888-8888-8888-888888888888',
        name: 'Offset',
        type: 'asset',
        initialValue: 600000, // Larger than mortgage
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const mortgage: Account = {
        id: 'mort-8888-8888-8888-888888888888',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06, // 6% interest
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, offsetAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;
      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      
      // Effective balance: max(0, $500k - $600k) = $0
      // Interest: $0 * 6% = $0
      expect(mortResult.growth).toBe(0);
      
      // No payment needed for interest-only with zero interest
      expect(bankResult.withdrawals).toBe(0);
    });

    it('pays off liability when linked asset sells', () => {
      const bankAccount: Account = {
        id: 'bank-4444-4444-4444-444444444444',
        name: 'Bank',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const property: Account = {
        id: 'prop-4444-4444-4444-444444444444',
        name: 'Investment Property',
        type: 'asset',
        initialValue: 800000,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: bankAccount.id,
        costBase: 600000,
      };

      const propertyLoan: Account = {
        id: 'loan-4444-4444-4444-444444444444',
        name: 'Property Loan',
        type: 'liability',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.065,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        payoffFromAccountId: property.id, // Pay off when property sells
      };

      const result = calculateForecast({
        accounts: [bankAccount, property, propertyLoan],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const loanResult = result.years[0].accounts.find(a => a.accountId === propertyLoan.id)!;
      
      // Loan paid off: balance should be 0 or negative
      expect(loanResult.endValue).toBeLessThanOrEqual(0);
      
      // Bank receives: $50k + ($800k - $300k loan payoff) = $550k
      // But before any interest calculations
      expect(bankResult.endValue).toBeGreaterThan(400000);
    });

    it('auto-calculates payment to pay off by end date', () => {
      const bankAccount: Account = {
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      const carLoan: Account = {
        id: 'loan-5555-5555-5555-555555555555',
        name: 'Car Loan',
        type: 'liability',
        initialValue: 30000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.08, // 8% interest
        paymentType: 'principalAndInterest',
        calculatePayment: true,
        endCondition: { type: 'year', year: 2027 }, // 3 year loan
        fundedByAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, carLoan],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      const loan2027 = result.years.find(y => y.year === 2027)!.accounts.find(a => a.accountId === carLoan.id)!;
      
      // Loan should be nearly paid off by end year (allow small remainder due to rounding)
      expect(loan2027.endValue).toBeLessThan(2000); // Should be significantly reduced
      expect(loan2027.endValue).toBeLessThan(result.years[0].accounts.find(a => a.accountId === carLoan.id)!.endValue);
    });
  });
});
