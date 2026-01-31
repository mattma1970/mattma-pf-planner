import { describe, it, expect } from 'vitest';
import { calculateForecast } from './forecast';
import type { Assumptions, Epoch, Person, Event, Settings } from '../schemas';
import { defaultSettings } from '../schemas';
import { createTestAccount } from '../test/fixtures';

describe('calculateForecast', () => {
  const defaultAssumptions: Assumptions = {
    cpi: { baseValue: 0.03 },
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
      const incomeAccount = createTestAccount({
        id: 'income-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'zero',
      });

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
      const houseAccount = createTestAccount({
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 1000000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'transfer',
        transferToAccountId: 'cash-1111-1111-1111-111111111111',
      });

      const cashAccount = createTestAccount({
        id: 'cash-1111-1111-1111-111111111111',
        name: 'Cash',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      });

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
      const expenseAccount = createTestAccount({
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Insurance',
        type: 'expense',
        initialValue: 5000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'hold',
      });

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
      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        depositsToAccountId: 'bank-1111-1111-1111-111111111111',
      });

      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      });

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
      const livingCostsAccount = createTestAccount({
        id: 'living-1111-1111-1111-111111111111',
        name: 'Living Costs',
        type: 'expense',
        initialValue: 60000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        fundedByAccountId: 'bank-1111-1111-1111-111111111111',
      });

      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      });

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
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 600000,
        growthProfile: { type: 'fixed', rate: 0.02 },
      });

      const houseAccount = createTestAccount({
        id: 'house-1111-1111-1111-111111111111',
        name: 'Investment Property',
        type: 'asset',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0.05 },
      });

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
      const superAccount = createTestAccount({
        id: 'super-1111-1111-1111-111111111111',
        name: 'Superannuation',
        type: 'asset',
        owner: defaultPerson.id,
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.07 },
        endCondition: { type: 'age', personId: defaultPerson.id, age: 67 },
        endBehavior: 'zero',
      });

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
      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

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
      const salaryAccount = createTestAccount({
        id: 'salary-2222-2222-2222-222222222222',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const bankAccount = createTestAccount({
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

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
      const salaryAccount = createTestAccount({
        id: 'salary-3333-3333-3333-333333333333',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const bankAccount = createTestAccount({
        id: 'bank-3333-3333-3333-333333333333',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

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
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.10 },
      });

      const houseAccount = createTestAccount({
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'transfer',
        transferToAccountId: bankAccount.id,
      });

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
      
      expect(bank2025.growth).toBeCloseTo(10000, 2);
      expect(bank2025.endValue).toBeCloseTo(610000, 2);
    });

    it('uses average balance method when configured', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.10 },
      });

      const houseAccount = createTestAccount({
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'transfer',
        transferToAccountId: bankAccount.id,
      });

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
      
      expect(bank2025.growth).toBeCloseTo(35000, 2);
      expect(bank2025.endValue).toBeCloseTo(635000, 2);
    });
  });

  describe('auto-topup', () => {
    it('tops up account when balance falls below threshold', () => {
      const bankAccount = createTestAccount({
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
      });

      const pensionAccount = createTestAccount({
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const expenseAccount = createTestAccount({
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(bank2025.endValue).toBe(0);
      expect(bank2025.contributions).toBe(40000);
      
      expect(pension2025.endValue).toBe(460000);
      expect(pension2025.withdrawals).toBe(40000);
    });

    it('tops up to target balance when specified', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
        autoTopup: {
          enabled: true,
          threshold: 0,
          fromAccountId: 'pension-1111-1111-1111-111111111111',
          targetBalance: 20000,
        },
      });

      const pensionAccount = createTestAccount({
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const expenseAccount = createTestAccount({
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(bank2025.endValue).toBe(20000);
      expect(bank2025.contributions).toBe(60000);
      
      expect(pension2025.endValue).toBe(440000);
    });

    it('allows source account to go negative if insufficient funds', () => {
      const bankAccount = createTestAccount({
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
      });

      const pensionAccount = createTestAccount({
        id: 'pension-1111-1111-1111-111111111111',
        name: 'Pension Fund',
        type: 'asset',
        initialValue: 20000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const expenseAccount = createTestAccount({
        id: 'expense-1111-1111-1111-111111111111',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(bank2025.endValue).toBe(0);
      
      expect(pension2025.endValue).toBe(-20000);
    });
  });

  describe('liability calculations', () => {
    it('accrues interest on liability balance', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-1111-1111-1111-111111111111',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(30000);
      expect(mortResult.endValue).toBe(500000);
      
      expect(bankResult.withdrawals).toBe(30000);
      expect(bankResult.endValue).toBe(70000);
    });

    it('reduces principal with P&I payments', () => {
      const bankAccount = createTestAccount({
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-2222-2222-2222-222222222222',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.05,
        paymentType: 'principalAndInterest',
        annualPayment: 25000,
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(5000);
      expect(mortResult.withdrawals).toBe(20000);
      expect(mortResult.endValue).toBe(80000);
    });

    it('applies offset account to reduce interest', () => {
      const bankAccount = createTestAccount({
        id: 'bank-3333-3333-3333-333333333333',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const offsetAccount = createTestAccount({
        id: 'offset-3333-3333-3333-333333333333',
        name: 'Offset',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-3333-3333-3333-333333333333',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(18000);
    });

    it('calculates correct payment with offset account and auto-calculate', () => {
      const bankAccount = createTestAccount({
        id: 'bank-6666-6666-6666-666666666666',
        name: 'Bank',
        type: 'asset',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const offsetAccount = createTestAccount({
        id: 'offset-6666-6666-6666-666666666666',
        name: 'Offset',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-6666-6666-6666-666666666666',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06,
        paymentType: 'principalAndInterest',
        calculatePayment: true,
        endCondition: { type: 'year', year: 2027 },
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(6000);
      
      const expectedPayment = 100000 + 6000;
      expect(bankResult.withdrawals).toBe(expectedPayment);
      
      expect(mortResult.endValue).toBe(200000);
    });

    it('bank withdrawals match liability payment exactly', () => {
      const bankAccount = createTestAccount({
        id: 'bank-7777-7777-7777-777777777777',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-7777-7777-7777-777777777777',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.05,
        paymentType: 'principalAndInterest',
        annualPayment: 30000,
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(5000);
      expect(mortResult.withdrawals).toBe(25000);
      
      expect(bankResult.withdrawals).toBe(30000);
      
      expect(mortResult.endValue).toBe(75000);
      expect(bankResult.endValue).toBe(170000);
    });

    it('liability growthProfile is ignored (interest handled separately)', () => {
      const bankAccount = createTestAccount({
        id: 'bank-9999-9999-9999-999999999999',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-9999-9999-9999-999999999999',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        interestRate: 0.06,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(6000);
      
      expect(bankResult.withdrawals).toBe(6000);
      
      expect(mortResult.endValue).toBe(100000);
    });

    it('offset account larger than mortgage results in zero interest', () => {
      const bankAccount = createTestAccount({
        id: 'bank-8888-8888-8888-888888888888',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const offsetAccount = createTestAccount({
        id: 'offset-8888-8888-8888-888888888888',
        name: 'Offset',
        type: 'asset',
        initialValue: 600000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-8888-8888-8888-888888888888',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.06,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        offsetAccountId: offsetAccount.id,
      });

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
      
      expect(mortResult.growth).toBe(0);
      
      expect(bankResult.withdrawals).toBe(0);
    });

    it('pays off liability when linked asset sells', () => {
      const bankAccount = createTestAccount({
        id: 'bank-4444-4444-4444-444444444444',
        name: 'Bank',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const property = createTestAccount({
        id: 'prop-4444-4444-4444-444444444444',
        name: 'Investment Property',
        type: 'asset',
        initialValue: 800000,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: bankAccount.id,
        costBase: 600000,
      });

      const propertyLoan = createTestAccount({
        id: 'loan-4444-4444-4444-444444444444',
        name: 'Property Loan',
        type: 'liability',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.065,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        payoffFromAccountId: property.id,
      });

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
      
      expect(loanResult.endValue).toBeLessThanOrEqual(0);
      
      expect(bankResult.endValue).toBeGreaterThan(400000);
    });

    it('auto-calculates payment to pay off by end date', () => {
      const bankAccount = createTestAccount({
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const carLoan = createTestAccount({
        id: 'loan-5555-5555-5555-555555555555',
        name: 'Car Loan',
        type: 'liability',
        initialValue: 30000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.08,
        paymentType: 'principalAndInterest',
        calculatePayment: true,
        endCondition: { type: 'year', year: 2027 },
        fundedByAccountId: bankAccount.id,
      });

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
      
      expect(loan2027.endValue).toBeLessThan(2000);
      expect(loan2027.endValue).toBeLessThan(result.years[0].accounts.find(a => a.accountId === carLoan.id)!.endValue);
    });
  });

  describe('super contribution carry-forward', () => {
    it('tracks carry-forward in off-balance sheet when no contributions made', () => {
      const result = calculateForecast({
        accounts: [],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      const year2026 = result.years.find(y => y.year === 2026)!;
      const year2027 = result.years.find(y => y.year === 2027)!;

      expect(year2025.offBalanceSheet).toBeDefined();
      expect(year2025.offBalanceSheet!.length).toBe(2);
      
      const conc2025 = year2025.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2025.opening).toBe(30000);
      expect(conc2025.movement).toBeCloseTo(0);
      expect(conc2025.closing).toBe(30000);

      const nonConc2025 = year2025.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConc2025.opening).toBe(120000);
      expect(nonConc2025.closing).toBe(120000);

      const conc2026 = year2026.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2026.opening).toBe(60000);
      expect(conc2026.closing).toBe(60000);

      const conc2027 = year2027.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2027.opening).toBe(90000);
      expect(conc2027.closing).toBe(90000);
    });

    it('reduces carry-forward when contributions are made', () => {
      const superContributionEvent: Event = {
        id: 'super-contrib-1111-1111-111111111111',
        year: 2026,
        type: 'superContribution',
        description: 'Salary sacrifice',
        amount: 20000,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: defaultPerson.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [superContributionEvent],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      const year2026 = result.years.find(y => y.year === 2026)!;
      const year2027 = result.years.find(y => y.year === 2027)!;

      const conc2025 = year2025.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2025.opening).toBe(30000);
      expect(conc2025.closing).toBe(30000);

      const conc2026 = year2026.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2026.opening).toBe(60000);
      expect(conc2026.movement).toBe(-20000);
      expect(conc2026.closing).toBe(40000);

      const conc2027 = year2027.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(conc2027.opening).toBe(70000);
      expect(conc2027.closing).toBe(70000);
    });
  });

  describe('super contribution tax integration', () => {
    const superAccount = createTestAccount({
      id: 'super-1111-1111-1111-111111111111',
      name: 'Super Fund',
      type: 'asset',
      initialValue: 100000,
      growthProfile: { type: 'fixed', rate: 0.07 },
      assetSubType: 'superannuation',
      superConfig: { phase: 'accumulation' },
    });

    const bankAccount = createTestAccount({
      id: 'bank-1111-1111-1111-111111111111',
      name: 'Bank',
      type: 'asset',
      initialValue: 50000,
      growthProfile: { type: 'fixed', rate: 0.02 },
    });

    const person: Person = {
      id: 'person-1111-1111-1111-111111111111',
      name: 'Test Person',
      birthYear: 1980,
    };

    it('applies 15% contributions tax on concessional contributions', () => {
      const contributionEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Employer SG',
        amount: 20000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'employerSG',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;

      const expectedContributionsTax = 20000 * 0.15;
      expect(superResult.contributions).toBe(20000);
      expect(superResult.withdrawals).toBe(expectedContributionsTax);
      expect(superResult.endValue).toBe(100000 * 1.07 + 20000 - expectedContributionsTax);

      const contribTaxEvent = year2025.taxEvents.find(e => e.type === 'superContributionTax');
      expect(contribTaxEvent).toBeDefined();
      expect(contribTaxEvent!.description).toContain('Contributions Tax');
    });

    it('applies Division 293 tax for high-income earners', () => {
      const incomeAccount = createTestAccount({
        id: 'income-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        initialValue: 260000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: bankAccount.id,
        owner: person.id,
      });

      const contributionEvent: Event = {
        id: 'event-2222-2222-2222-222222222222',
        year: 2025,
        type: 'superContribution',
        description: 'Employer SG',
        amount: 27500,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'employerSG',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount, bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];

      const div293Event = year2025.taxEvents.find(e => e.type === 'division293Tax');
      expect(div293Event).toBeDefined();
      expect(div293Event!.description).toContain('Div 293');
    });

    it('deducts salary sacrifice from source account and adds to super', () => {
      const contributionEvent: Event = {
        id: 'event-3333-3333-3333-333333333333',
        year: 2025,
        type: 'superContribution',
        description: 'Salary Sacrifice',
        amount: 15000,
        sourceAccountId: bankAccount.id,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;
      const bankResult = year2025.accounts.find(a => a.accountId === bankAccount.id)!;

      expect(bankResult.transfers).toBe(-15000);
      
      const expectedTax = 15000 * 0.15;
      expect(superResult.contributions).toBe(15000);
      expect(superResult.withdrawals).toBe(expectedTax);
    });

    it('does not apply contributions tax on non-concessional contributions', () => {
      const contributionEvent: Event = {
        id: 'event-4444-4444-4444-444444444444',
        year: 2025,
        type: 'superContribution',
        description: 'After-tax contribution',
        amount: 50000,
        sourceAccountId: bankAccount.id,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;

      expect(superResult.contributions).toBe(50000);
      expect(superResult.withdrawals).toBe(0);
      expect(superResult.endValue).toBe(100000 * 1.07 + 50000);
    });

    it('adds full contribution amount to super regardless of cap allocation', () => {
      const contributionEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Large concessional contribution',
        amount: 50000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;

      expect(superResult.contributions).toBe(50000);
      
      expect(superResult.withdrawals).toBe(4500);
      
      expect(superResult.endValue).toBe(100000 * 1.07 + 50000 - 4500);
    });

    it('excess concessional reduces non-concessional cap in off-balance sheet', () => {
      const contributionEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Large concessional',
        amount: 50000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      const concCap = year2025.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      expect(concCap.opening).toBe(30000);
      expect(concCap.movement).toBe(-30000);
      expect(concCap.closing).toBe(0);
      
      const nonConcCap = year2025.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConcCap.opening).toBe(120000);
      expect(nonConcCap.movement).toBe(-20000);
      expect(nonConcCap.closing).toBe(100000);
    });

    it('salary sacrifice (pre-tax): excess over cap is added back to assessable income', () => {
      const contributionEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Large salary sacrifice',
        amount: 50000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      const deductionEvent = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Salary Sacrifice')
      );
      expect(deductionEvent).toBeDefined();
      expect(deductionEvent!.assessableAmount).toBe(-50000);
      
      const excessTaxEvent = year2025.taxEvents.find(e => 
        e.type === 'incomeTax' && e.description.includes('Excess Concessional')
      );
      expect(excessTaxEvent).toBeDefined();
      expect(excessTaxEvent!.assessableAmount).toBe(20000);
    });

    it('personal deductible (post-tax): only cap amount is deductible, excess not taxed again', () => {
      const contributionEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Large personal deductible',
        amount: 50000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [contributionEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      const deductionEvent = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Personal Deductible')
      );
      expect(deductionEvent).toBeDefined();
      expect(deductionEvent!.assessableAmount).toBe(-30000);
      
      const excessTaxEvent = year2025.taxEvents.find(e => 
        e.type === 'incomeTax' && e.description.includes('Excess')
      );
      expect(excessTaxEvent).toBeUndefined();
    });

    it('combined pre-tax and post-tax: pre-tax uses cap first, then post-tax', () => {
      const salarySacrificeEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Salary sacrifice',
        amount: 20000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const personalEvent: Event = {
        id: 'event-2222-2222-2222-222222222222',
        year: 2025,
        type: 'superContribution',
        description: 'Personal deductible',
        amount: 20000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [salarySacrificeEvent, personalEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      const salSacDeduction = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Salary Sacrifice')
      );
      expect(salSacDeduction).toBeDefined();
      expect(salSacDeduction!.assessableAmount).toBe(-20000);
      
      const personalDeduction = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Personal Deductible')
      );
      expect(personalDeduction).toBeDefined();
      expect(personalDeduction!.assessableAmount).toBe(-10000);
      
      const excessTaxEvent = year2025.taxEvents.find(e => 
        e.type === 'incomeTax' && e.description.includes('Excess')
      );
      expect(excessTaxEvent).toBeUndefined();
    });

    it('salary sacrifice exceeds cap with post-tax also contributing', () => {
      const salarySacrificeEvent: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Salary sacrifice',
        amount: 35000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const personalEvent: Event = {
        id: 'event-2222-2222-2222-222222222222',
        year: 2025,
        type: 'superContribution',
        description: 'Personal deductible',
        amount: 10000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [salarySacrificeEvent, personalEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      const salSacDeduction = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Salary Sacrifice')
      );
      expect(salSacDeduction).toBeDefined();
      expect(salSacDeduction!.assessableAmount).toBe(-35000);
      
      const excessTaxEvent = year2025.taxEvents.find(e => 
        e.type === 'incomeTax' && e.description.includes('Excess Concessional')
      );
      expect(excessTaxEvent).toBeDefined();
      expect(excessTaxEvent!.assessableAmount).toBe(5000);
      
      const personalDeduction = year2025.taxEvents.find(e => 
        e.type === 'taxDeduction' && e.description.includes('Personal Deductible')
      );
      expect(personalDeduction).toBeUndefined();
    });

    it('exemptFromCap contributions bypass both cap calculations', () => {
      const downsizer: Event = {
        id: 'event-1111-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Downsizer contribution',
        amount: 300000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'downsizer',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: true,
        },
      };

      const result = calculateForecast({
        accounts: [superAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [downsizer],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;
      
      expect(superResult.contributions).toBe(300000);
      
      const nonConcCap = year2025.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConcCap.opening).toBe(120000);
      expect(nonConcCap.movement).toBeCloseTo(0);
      expect(nonConcCap.closing).toBe(120000);
    });

    it('blocked non-concessional contributions do not deduct from source bank account', () => {
      const superAccountWithOwner = createTestAccount({
        ...superAccount,
        owner: person.id,
      });

      // Year 1: contribute $360k to exhaust the 3-year bring-forward
      const maxOutContribution: Event = {
        id: 'event-maxout-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Max out bring-forward',
        amount: 360000,
        sourceAccountId: bankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      // Year 2: try to contribute $50k - should be fully blocked
      const blockedContribution: Event = {
        id: 'event-blocked-1111-1111-111111111111',
        year: 2026,
        type: 'superContribution',
        description: 'Blocked contribution',
        amount: 50000,
        sourceAccountId: bankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccountWithOwner, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [maxOutContribution, blockedContribution],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      // Year 2025: $360k contributed, cap goes from 120k to -240k (floor)
      const year2025 = result.years.find(y => y.year === 2025)!;
      const nonConcCap2025 = year2025.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConcCap2025.opening).toBe(120000);
      expect(nonConcCap2025.closing).toBe(-240000);
      
      // Super contributions are tracked as transfers (negative = outflow from source)
      const bankResult2025 = year2025.accounts.find(a => a.accountId === bankAccount.id)!;
      expect(bankResult2025.transfers).toBe(-360000);

      // Year 2026: opening = -240k + 120k = -120k, which is <= 0, so ALL contributions blocked
      const year2026 = result.years.find(y => y.year === 2026)!;
      const nonConcCap2026 = year2026.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConcCap2026.opening).toBe(-120000); // prior closing + 120k annual cap
      expect(nonConcCap2026.movement).toBe(0); // no contributions allowed
      expect(nonConcCap2026.closing).toBe(-120000);
      
      // Super should NOT receive the blocked $50k
      const superResult2026 = year2026.accounts.find(a => a.accountId === superAccountWithOwner.id)!;
      expect(superResult2026.contributions).toBe(0);
      
      // Bank should NOT have $50k transferred out (the fix!)
      const bankResult2026 = year2026.accounts.find(a => a.accountId === bankAccount.id)!;
      expect(bankResult2026.transfers).toBe(0);
    });

    it('excess concessional contributions blocked when non-concessional cap exhausted', () => {
      const superAccountWithOwner = createTestAccount({
        ...superAccount,
        owner: person.id,
      });

      const largeBankAccount = createTestAccount({
        ...bankAccount,
        initialValue: 500000,
      });

      // Year 1: contribute $360k as concessional - this will:
      // - Use $30k against concessional cap
      // - Have $330k excess flow to non-concessional cap (exhausts 120k + 240k bring-forward)
      const maxOutConcessional: Event = {
        id: 'event-maxout-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Large concessional contribution',
        amount: 360000,
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      // Year 2: try to contribute $60k concessional
      // - $30k goes to concessional cap (allowed)
      // - $30k excess should be blocked (non-concessional cap exhausted)
      const blockedExcess: Event = {
        id: 'event-blocked-1111-1111-111111111111',
        year: 2026,
        type: 'superContribution',
        description: 'Contribution with blocked excess',
        amount: 60000,
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccountWithOwner, largeBankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [maxOutConcessional, blockedExcess],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      // Year 2025: $360k contributed
      // - Concessional cap: uses $30k, excess $330k flows to non-concessional
      // - Non-concessional cap: opening 120k, after 330k usage = -210k (but floored at -240k means all 330k allowed)
      const year2025 = result.years.find(y => y.year === 2025)!;
      const bankResult2025 = year2025.accounts.find(a => a.accountId === largeBankAccount.id)!;
      // Full $360k should be transferred (all fits within combined caps)
      expect(bankResult2025.transfers).toBe(-360000);

      // Year 2026: 
      // - Non-conc cap opening = -210k + 120k = -90k (or similar, depending on exact calc)
      // - Opening <= 0, so excess concessional is blocked
      const year2026 = result.years.find(y => y.year === 2026)!;
      const nonConcCap2026 = year2026.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      // Opening should be <= 0 (prior closing + 120k annual top-up)
      expect(nonConcCap2026.opening).toBeLessThanOrEqual(0);
      
      // Super should receive less than $60k (only concessional portion, excess blocked)
      const superResult2026 = year2026.accounts.find(a => a.accountId === superAccountWithOwner.id)!;
      // The $30k concessional cap portion is allowed, but the $30k excess is blocked
      expect(superResult2026.contributions).toBeLessThan(60000);
      expect(superResult2026.contributions).toBeGreaterThan(0);
      
      // Bank transfer should match what super received
      const bankResult2026 = year2026.accounts.find(a => a.accountId === largeBankAccount.id)!;
      expect(bankResult2026.transfers).toBe(-superResult2026.contributions);
    });

    it('mixed concessional and non-concessional both blocked when cap exhausted', () => {
      const superAccountWithOwner = createTestAccount({
        ...superAccount,
        owner: person.id,
      });

      const largeBankAccount = createTestAccount({
        ...bankAccount,
        initialValue: 1000000,
      });

      // Year 1: exhaust non-concessional cap AND use up concessional carry-forward
      // Use large concessional ($150k) to eat into carry-forward
      const useCarryForward: Event = {
        id: 'event-carryforward-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Use concessional carry-forward',
        amount: 150000, // Will use $30k cap + up to $90k carry-forward (3 years)
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };
      
      // Also max out non-concessional in same year
      const maxOutNonConcessional: Event = {
        id: 'event-maxout-1111-1111-111111111111',
        year: 2025,
        type: 'superContribution',
        description: 'Max out bring-forward',
        amount: 360000,
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      // Year 2: try both types - both should be partially/fully blocked
      const blockedNonConcessional: Event = {
        id: 'event-blocked-nc-1111-111111111111',
        year: 2026,
        type: 'superContribution',
        description: 'Blocked non-concessional',
        amount: 50000,
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      // Large concessional - will have excess that should be blocked
      const concessionalWithExcess: Event = {
        id: 'event-conc-excess-1111-111111111111',
        year: 2026,
        type: 'superContribution',
        description: 'Concessional with blocked excess',
        amount: 60000, // Only $30k fits in concessional cap, $30k excess blocked by non-conc cap
        sourceAccountId: largeBankAccount.id,
        targetAccountId: superAccountWithOwner.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: person.id,
          reducesAssessableIncome: true,
          exemptFromCap: false,
        },
      };

      const result = calculateForecast({
        accounts: [superAccountWithOwner, largeBankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [useCarryForward, maxOutNonConcessional, blockedNonConcessional, concessionalWithExcess],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2026 = result.years.find(y => y.year === 2026)!;
      
      // Non-concessional cap should be at opening <= 0
      const nonConcCap2026 = year2026.offBalanceSheet!.find(i => i.type === 'nonConcessionalCapAccount')!;
      expect(nonConcCap2026.opening).toBeLessThanOrEqual(0);
      expect(nonConcCap2026.movement).toBe(0); // No usage when opening <= 0
      
      // Concessional cap in 2026: only $30k available (no more carry-forward)
      const concCap2026 = year2026.offBalanceSheet!.find(i => i.type === 'concessionalCapAccount')!;
      // Opening should be just the current year cap ($30k) since carry-forward was used up
      expect(concCap2026.opening).toBeLessThanOrEqual(30000);
      
      // Super should only receive the concessional portion within cap
      // The $50k non-concessional is fully blocked
      // The concessional excess is also blocked
      const superResult2026 = year2026.accounts.find(a => a.accountId === superAccountWithOwner.id)!;
      // Should be $30k (concessional within cap) - $50k non-conc blocked, $30k conc excess blocked
      expect(superResult2026.contributions).toBe(30000);
      
      // Bank should only transfer what super received
      const bankResult2026 = year2026.accounts.find(a => a.accountId === largeBankAccount.id)!;
      expect(bankResult2026.transfers).toBe(-30000);
    });
  });

  describe('balance-based expenses', () => {
    it('calculates expense as percentage of asset balance', () => {
      const houseAccount = createTestAccount({
        id: 'house-1111-1111-1111-111111111111',
        name: 'House',
        type: 'asset',
        initialValue: 1000000,
        growthProfile: { type: 'fixed', rate: 0.05 },
      });

      const maintenanceAccount = createTestAccount({
        id: 'maint-1111-1111-1111-111111111111',
        name: 'Maintenance',
        type: 'expense',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: houseAccount.id,
        basedOnPercentage: 0.005,
      });

      const result = calculateForecast({
        accounts: [houseAccount, maintenanceAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      const year2025 = result.years[0];
      const maint2025 = year2025.accounts.find(a => a.accountId === maintenanceAccount.id)!;
      expect(maint2025.endValue).toBe(5000);

      const year2026 = result.years[1];
      const maint2026 = year2026.accounts.find(a => a.accountId === maintenanceAccount.id)!;
      expect(maint2026.endValue).toBe(5250);

      const year2027 = result.years[2];
      const maint2027 = year2027.accounts.find(a => a.accountId === maintenanceAccount.id)!;
      expect(maint2027.endValue).toBeCloseTo(5512.5, 1);
    });
  });

  describe('periodic expenses', () => {
    it('only incurs expense every X years', () => {
      const vehicleReplacement = createTestAccount({
        id: 'vehicle-1111-1111-1111-111111111111',
        name: 'Vehicle Replacement',
        type: 'expense',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
        occursEveryYears: 3,
      });

      const result = calculateForecast({
        accounts: [vehicleReplacement],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2031,
      });

      const getExpense = (yr: number) => 
        result.years.find(y => y.year === yr)?.accounts.find(a => a.accountId === vehicleReplacement.id)?.endValue ?? 0;

      expect(getExpense(2025)).toBe(50000);
      expect(getExpense(2026)).toBe(0);
      expect(getExpense(2027)).toBe(0);
      expect(getExpense(2028)).toBe(50000);
      expect(getExpense(2029)).toBe(0);
      expect(getExpense(2030)).toBe(0);
      expect(getExpense(2031)).toBe(50000);
    });

    it('applies growth to periodic expenses', () => {
      const medicalCheckup = createTestAccount({
        id: 'medical-1111-1111-1111-111111111111',
        name: 'Medical Checkup',
        type: 'expense',
        initialValue: 2000,
        growthProfile: { type: 'cpiLinked', operation: 'add', value: 0 },
        occursEveryYears: 2,
      });

      const result = calculateForecast({
        accounts: [medicalCheckup],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2029,
      });

      const getExpense = (yr: number) => 
        result.years.find(y => y.year === yr)?.accounts.find(a => a.accountId === medicalCheckup.id)?.endValue ?? 0;

      expect(getExpense(2025)).toBeCloseTo(2000, 0);
      expect(getExpense(2026)).toBe(0);
      expect(getExpense(2027)).toBeCloseTo(2121.8, 0);
      expect(getExpense(2028)).toBe(0);
      expect(getExpense(2029)).toBeCloseTo(2251.02, 0);
    });

    it('combines balance-based and periodic expense', () => {
      const houseAccount = createTestAccount({
        id: 'house-2222-2222-2222-222222222222',
        name: 'House',
        type: 'asset',
        initialValue: 800000,
        growthProfile: { type: 'fixed', rate: 0.04 },
      });

      const roofReplacement = createTestAccount({
        id: 'roof-1111-1111-1111-111111111111',
        name: 'Roof Replacement',
        type: 'expense',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: houseAccount.id,
        basedOnPercentage: 0.03,
        occursEveryYears: 5,
      });

      const result = calculateForecast({
        accounts: [houseAccount, roofReplacement],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2035,
      });

      const getExpense = (yr: number) => 
        result.years.find(y => y.year === yr)?.accounts.find(a => a.accountId === roofReplacement.id)?.endValue ?? 0;

      expect(getExpense(2025)).toBe(24000);
      expect(getExpense(2026)).toBe(0);
      expect(getExpense(2027)).toBe(0);
      expect(getExpense(2028)).toBe(0);
      expect(getExpense(2029)).toBe(0);
      expect(getExpense(2030)).toBeCloseTo(29199.51, 0);
    });

    it('returns zero expense when reference account has not started yet', () => {
      const investmentProperty = createTestAccount({
        id: 'prop-1111-1111-1111-111111111111',
        name: 'Investment Property',
        type: 'asset',
        initialValue: 1000000,
        growthProfile: { type: 'fixed', rate: 0.04 },
        startCondition: { type: 'year', year: 2028 },
      });

      const propertyMaintenance = createTestAccount({
        id: 'propmaint-1111-1111-1111-111111111111',
        name: 'Property Maintenance',
        type: 'expense',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: investmentProperty.id,
        basedOnPercentage: 0.01,
      });

      const result = calculateForecast({
        accounts: [investmentProperty, propertyMaintenance],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2030,
      });

      const getExpense = (yr: number) => 
        result.years.find(y => y.year === yr)?.accounts.find(a => a.accountId === propertyMaintenance.id)?.endValue ?? 0;

      expect(getExpense(2025)).toBe(0);
      expect(getExpense(2026)).toBe(0);
      expect(getExpense(2027)).toBe(0);
      
      expect(getExpense(2028)).toBe(10000);
      
      expect(getExpense(2029)).toBe(10400);
      
      expect(getExpense(2030)).toBeCloseTo(10816, 0);
    });
  });
});
