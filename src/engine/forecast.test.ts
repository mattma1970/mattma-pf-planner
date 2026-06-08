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
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
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
      expect(cash2027!.transfers).toBe(houseValueBeforeSale);
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
      // With income included in growth calculation: average balance = 10000 + 0.5 * 100000 = 60000
      // growth = 60000 * 0.02 = 1200, endValue = 10000 + 100000 + 1200 = 111200
      expect(bank2025!.endValue).toBe(111200);
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
      // Expense is included in balance for growth: balance = 100000 + 0.5*(-61800) = 69100
      // growth = 69100 * 0.02 = 1382, endValue = 100000 + 1382 - 61800 = 39582
      expect(bank2025!.endValue).toBe(39582);
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
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
        startYear: 2025,
        endYear: 2027,
      });

      const year2026 = result.years.find((y) => y.year === 2026);
      expect(year2026).toBeDefined();

      const bank2026 = year2026!.accounts.find((a) => a.accountId === bankAccount.id);
      const house2026 = year2026!.accounts.find((a) => a.accountId === houseAccount.id);

      expect(bank2026!.transfers).toBe(-500000);
      expect(house2026!.transfers).toBe(500000);
      expect(house2026!.endValue).toBe(500000);
    });

    it('transfer to liability reduces the liability balance', () => {
      const bankAccount = createTestAccount({
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-2222-2222-2222-222222222222',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
      });

      const payDownEvent: Event = {
        id: 'event-2222-2222-2222-222222222222',
        year: 2025,
        type: 'transfer',
        description: 'Extra mortgage payment',
        amount: 50000,
        sourceAccountId: bankAccount.id,
        targetAccountId: mortgage.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, mortgage],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [payDownEvent],
        persons: [],
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
        startYear: 2025,
        endYear: 2025,
      });

      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const mortResult = result.years[0].accounts.find(a => a.accountId === mortgage.id)!;

      // Bank should have withdrawn 50000
      expect(bankResult.transfers).toBe(-50000);
      expect(bankResult.endValue).toBe(50000);

      // Mortgage should be reduced by 50000 (transfer TO liability reduces balance)
      expect(mortResult.transfers).toBe(50000);
      expect(mortResult.endValue).toBe(150000);
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
          fromAccountIds: ['pension-1111-1111-1111-111111111111'],
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
      expect(bank2025.transfers).toBe(40000);

      expect(pension2025.endValue).toBe(460000);
      expect(pension2025.transfers).toBe(-40000);
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
          fromAccountIds: ['pension-1111-1111-1111-111111111111'],
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
      expect(bank2025.transfers).toBe(60000);
      
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
          fromAccountIds: ['pension-1111-1111-1111-111111111111'],
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
      expect(mortResult.endValue).toBe(530000);
      
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
      expect(mortResult.transfers).toBe(20000);
      expect(mortResult.endValue).toBe(85000);
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

      expect(bankResult.withdrawals).toBe(6000);
      expect(bankResult.transfers).toBe(-100000);

      expect(mortResult.endValue).toBe(206000);
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
      expect(mortResult.transfers).toBe(25000);

      expect(bankResult.withdrawals).toBe(5000);
      expect(bankResult.transfers).toBe(-25000);

      expect(mortResult.endValue).toBe(80000);
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
      
      expect(mortResult.endValue).toBe(106000);
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

    it('negative offset account balance does not increase effective loan balance', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1010-1010-1010-101010101010',
        name: 'Bank',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      // Offset account with negative balance (overdrawn)
      const offsetAccount = createTestAccount({
        id: 'offset-1010-1010-1010-101010101010',
        name: 'Offset',
        type: 'asset',
        initialValue: -50000, // Negative balance
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const mortgage = createTestAccount({
        id: 'mort-1010-1010-1010-101010101010',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 100000,
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
      
      // Interest should be calculated on the full $100k loan, NOT $150k (loan - negative offset)
      // 6% of $100,000 = $6,000
      expect(mortResult.growth).toBe(6000);
      
      // Without fix, this would be 6% of $150k = $9,000
      expect(mortResult.growth).not.toBe(9000);
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
      
      expect(loanResult.endValue).toBe(0);
      
      expect(bankResult.endValue).toBe(550000);
    });

    it('pays off liability when linked asset sells with no CGT', () => {
      const bankAccount = createTestAccount({
        id: 'bank-6666-6666-6666-666666666666',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const car = createTestAccount({
        id: 'car-6666-6666-6666-666666666666',
        name: 'Car',
        type: 'asset',
        initialValue: 30000,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sellNoCgt',
        transferToAccountId: bankAccount.id,
      });

      const carLoan = createTestAccount({
        id: 'loan-6666-6666-6666-666666666666',
        name: 'Car Loan',
        type: 'liability',
        initialValue: 15000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.08,
        paymentType: 'interestOnly',
        fundedByAccountId: bankAccount.id,
        payoffFromAccountId: car.id,
      });

      const result = calculateForecast({
        accounts: [bankAccount, car, carLoan],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const bankResult = result.years[0].accounts.find(a => a.accountId === bankAccount.id)!;
      const loanResult = result.years[0].accounts.find(a => a.accountId === carLoan.id)!;
      
      // Loan should be paid off (payoff happens before interest)
      expect(loanResult.endValue).toBe(0);
      
      // Bank should receive sale proceeds without CGT
      expect(bankResult.endValue).toBe(25000);
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
      superConfig: { },
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
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
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

    it('does NOT apply Division 293 when salary sacrifice brings adjusted income below threshold', () => {
      // Scenario: $200k salary, $18k salary sacrifice, $23k employer SG
      // Adjusted income = ($200k - $18k) + $41k = $223k < $250k threshold
      // Therefore Div 293 should NOT apply
      const incomeAccount = createTestAccount({
        id: 'income-1111-1111-1111-111111111111',
        name: 'High Salary',
        type: 'income',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: bankAccount.id,
        owner: person.id,
      });

      const employerSGEvent: Event = {
        id: 'event-2222-2222-2222-222222222222',
        year: 2025,
        type: 'superContribution',
        description: 'Employer SG',
        amount: 23000,
        targetAccountId: superAccount.id,
        superContribution: {
          contributionType: 'concessional',
          source: 'employerSG',
          memberPersonId: person.id,
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      };

      const salarySacrificeEvent: Event = {
        id: 'event-3333-3333-3333-333333333333',
        year: 2025,
        type: 'superContribution',
        description: 'Salary Sacrifice',
        amount: 18000,
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
        accounts: [superAccount, bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [employerSGEvent, salarySacrificeEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      
      // Div 293 should NOT apply since adjusted income ($223k) is below threshold ($250k)
      const div293Event = year2025.taxEvents.find(e => e.type === 'division293Tax');
      expect(div293Event).toBeUndefined();
    });

    it('does not double-count employer SG in Div 293 calculation', () => {
      // Regression test: Employer SG from derived income accounts was being counted twice:
      // 1. Added to incomeByPerson as a derived income account
      // 2. AND included in concessionalWithinCap as a contribution
      // This caused Div 293 to trigger incorrectly.
      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: bankAccount.id,
        owner: person.id,
      });

      // Derived employer SG account - 11.5% of salary = $23k
      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115,
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
        owner: person.id,
      });

      const salarySacrificeEvent: Event = {
        id: 'event-4444-4444-4444-444444444444',
        year: 2025,
        type: 'superContribution',
        description: 'Salary Sacrifice',
        amount: 18000,
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
        accounts: [superAccount, bankAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [salarySacrificeEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];

      // Div 293 should NOT apply because:
      // - Taxable income = $200k (employer SG excluded - it's a contribution, not income)
      // - Salary sacrifice deduction = -$18k
      // - Taxable income after deduction = $182k
      // - Concessional contributions = $23k (employer SG) + $18k (salary sacrifice) = $41k
      // - Adjusted income for Div 293 = $182k + $41k = $223k < $250k threshold
      const div293Event = year2025.taxEvents.find(e => e.type === 'division293Tax');
      expect(div293Event).toBeUndefined();
    });

    it('applies Div 293 when income plus contributions exceed threshold', () => {
      // Contrasting test: Same structure but higher income that DOES trigger Div 293
      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 240000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: bankAccount.id,
        owner: person.id,
      });

      // Derived employer SG account - 11.5% of salary = $27,600
      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115,
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
        owner: person.id,
      });

      const salarySacrificeEvent: Event = {
        id: 'event-4444-4444-4444-444444444444',
        year: 2025,
        type: 'superContribution',
        description: 'Salary Sacrifice',
        amount: 20000,
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
        accounts: [superAccount, bankAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [salarySacrificeEvent],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];

      // Div 293 SHOULD apply because:
      // - Taxable income = $240k (employer SG excluded - it's not assessable income)
      // - Concessional contributions within cap = $27.6k (employer SG) + capped amount
      //   Note: $27.6k + $20k = $47.6k, but cap is $30k, so concessional within cap = $30k
      // - Adjusted income for Div 293 = $240k + $30k = $270k > $250k threshold
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
      expect(superResult.transfers).toBe(15000);
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
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const superResult = year2025.accounts.find(a => a.accountId === superAccount.id)!;

      expect(superResult.transfers).toBe(50000);
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
        settings: { ...testSettings, growthCalculationMethod: 'openingBalance' },
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
      expect(superResult2026.transfers).toBeLessThan(60000);
      expect(superResult2026.transfers).toBeGreaterThan(0);
      
      // Bank transfer should match what super received
      const bankResult2026 = year2026.accounts.find(a => a.accountId === largeBankAccount.id)!;
      expect(bankResult2026.transfers).toBe(-superResult2026.transfers);
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
      expect(superResult2026.transfers).toBe(30000);
      
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

  describe('derived income with super contribution', () => {
    it('calculates employer SG as percentage of salary and flows to super account', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 10000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const superAccount = createTestAccount({
        id: 'super-1111-1111-1111-111111111111',
        name: 'Super',
        type: 'asset',
        assetSubType: 'superannuation',
        superConfig: { },
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: bankAccount.id,
        owner: 'person-1111-1111-1111-111111111111',
      });

      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115, // 11.5%
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const result = calculateForecast({
        accounts: [bankAccount, superAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years.find((y) => y.year === 2025)!;
      
      // Employer SG should be 11.5% of $100,000 = $11,500
      const sgAccount = year2025.accounts.find((a) => a.accountId === employerSgAccount.id)!;
      expect(sgAccount.endValue).toBe(11500);
      
      // Super should receive the SG contribution (minus 15% contributions tax)
      // $11,500 contribution - $1,725 (15% tax) = $9,775 net
      const superResult = year2025.accounts.find((a) => a.accountId === superAccount.id)!;
      // Opening: $100,000 + $11,500 contribution - $1,725 contributions tax = $109,775
      expect(superResult.endValue).toBeCloseTo(109775, 0);
      
      // Salary should still deposit to bank
      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(bankResult.contributions).toBe(100000);
    });

    it('derived income follows the source income growth', () => {
      const bankAccount = createTestAccount({
        id: 'bank-1111-1111-1111-111111111111',
        name: 'Bank',
        type: 'asset',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const superAccount = createTestAccount({
        id: 'super-1111-1111-1111-111111111111',
        name: 'Super',
        type: 'asset',
        assetSubType: 'superannuation',
        superConfig: { },
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.05 }, // 5% growth
        depositsToAccountId: bankAccount.id,
        owner: 'person-1111-1111-1111-111111111111',
      });

      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.10, // 10% for easier math
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const result = calculateForecast({
        accounts: [bankAccount, superAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      // Year 1: Salary $100,000 → SG $10,000
      const year2025 = result.years.find((y) => y.year === 2025)!;
      const salary2025 = year2025.accounts.find((a) => a.accountId === salaryAccount.id)!;
      const sg2025 = year2025.accounts.find((a) => a.accountId === employerSgAccount.id)!;
      expect(salary2025.endValue).toBe(100000);
      expect(sg2025.endValue).toBe(10000);
      
      // Year 2: Salary $105,000 → SG $10,500
      const year2026 = result.years.find((y) => y.year === 2026)!;
      const salary2026 = year2026.accounts.find((a) => a.accountId === salaryAccount.id)!;
      const sg2026 = year2026.accounts.find((a) => a.accountId === employerSgAccount.id)!;
      expect(salary2026.endValue).toBe(105000);
      expect(sg2026.endValue).toBe(10500);
      
      // Year 3: Salary $110,250 → SG $11,025
      const year2027 = result.years.find((y) => y.year === 2027)!;
      const salary2027 = year2027.accounts.find((a) => a.accountId === salaryAccount.id)!;
      const sg2027 = year2027.accounts.find((a) => a.accountId === employerSgAccount.id)!;
      expect(salary2027.endValue).toBeCloseTo(110250, 0);
      expect(sg2027.endValue).toBeCloseTo(11025, 0);
    });

    it('does not double-count super contributions from derived income', () => {
      // Regression test: superContributionConfig flows were being added both via
      // superContributionFlows AND derivedFlows, causing double-counting
      const superAccount = createTestAccount({
        id: 'super-1111-1111-1111-111111111111',
        name: 'Super',
        type: 'asset',
        assetSubType: 'superannuation',
        superConfig: { },
        initialValue: 0, // Start at 0 so we can verify exact contribution
        growthProfile: { type: 'fixed', rate: 0 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 75000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115, // 11.5% SG rate
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const result = calculateForecast({
        accounts: [superAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years.find((y) => y.year === 2025)!;
      
      // Employer SG should be 11.5% of $75,000 = $8,625
      const sgAccount = year2025.accounts.find((a) => a.accountId === employerSgAccount.id)!;
      expect(sgAccount.endValue).toBe(8625);
      
      // Super contributions field should show exactly $8,625 (not doubled to $17,250)
      const superResult = year2025.accounts.find((a) => a.accountId === superAccount.id)!;
      expect(superResult.contributions).toBe(8625);
      
      // Super endValue should be $8,625 - 15% contributions tax = $7,331.25
      // (starting from $0 with no growth)
      expect(superResult.endValue).toBeCloseTo(7331.25, 0);
    });

    it('generates warning for derived SG account without superContributionConfig', () => {
      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115,
        owner: 'person-1111-1111-1111-111111111111',
        // No superContributionConfig - this should trigger a warning
      });

      const result = calculateForecast({
        accounts: [salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      // Should have a warning in the first year
      const year2025 = result.years.find((y) => y.year === 2025)!;
      expect(year2025.warnings).toBeDefined();
      expect(year2025.warnings!.length).toBe(1);
      expect(year2025.warnings![0].type).toBe('incompleteEmployerSg');
      expect(year2025.warnings![0].accountId).toBe(employerSgAccount.id);
      expect(year2025.warnings![0].message).toContain('Employer SG account needs configuration');

      // Second year should NOT have the warning (only shown in first year)
      const year2026 = result.years.find((y) => y.year === 2026)!;
      expect(year2026.warnings).toBeUndefined();
    });

    it('does not generate warning for derived SG account with superContributionConfig', () => {
      const superAccount = createTestAccount({
        id: 'super-1111-1111-1111-111111111111',
        name: 'Super Account',
        type: 'asset',
        assetSubType: 'superannuation',
        owner: 'person-1111-1111-1111-111111111111',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.06 },
      });

      const salaryAccount = createTestAccount({
        id: 'salary-1111-1111-1111-111111111111',
        name: 'Salary',
        type: 'income',
        incomeSubType: 'salary',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0.05 },
        owner: 'person-1111-1111-1111-111111111111',
      });

      const employerSgAccount = createTestAccount({
        id: 'employer-sg-1111-1111-111111111111',
        name: 'Employer SG',
        type: 'income',
        incomeSubType: 'other',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        basedOnAccountId: salaryAccount.id,
        basedOnPercentage: 0.115,
        owner: 'person-1111-1111-1111-111111111111',
        superContributionConfig: {
          targetSuperAccountId: superAccount.id,
          contributionType: 'concessional',
          source: 'employerSG',
          reducesAssessableIncome: false,
        },
      });

      const result = calculateForecast({
        accounts: [superAccount, salaryAccount, employerSgAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      // Should not have any incompleteEmployerSg warnings
      const year2025 = result.years.find((y) => y.year === 2025)!;
      const sgWarnings = year2025.warnings?.filter(w => w.type === 'incompleteEmployerSg') ?? [];
      expect(sgWarnings.length).toBe(0);
    });
  });

  describe('capital loss carry-forward', () => {
    const person: Person = {
      id: 'person-1111-1111-1111-111111111111',
      name: 'Test Person',
      birthYear: 1980,
    };

    const cashAccount = createTestAccount({
      id: 'cash-1111-1111-1111-111111111111',
      name: 'Cash',
      type: 'asset',
      initialValue: 500000,
      growthProfile: { type: 'fixed', rate: 0 },
    });

    it('capital loss is carried forward when no gains in year', () => {
      const losingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Losing Asset',
        type: 'asset',
        initialValue: 70000,
        costBase: 100000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [losingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      
      const losingAssetResult = year2025.accounts.find(a => a.accountId === losingAsset.id);
      expect(losingAssetResult?.endValue).toBe(0);
      
      const lossCarryForward = year2025.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward).toBeDefined();
      expect(lossCarryForward!.closing).toBe(30000);
      expect(lossCarryForward!.personId).toBe(person.id);
    });

    it('capital loss offsets gain in same year', () => {
      const losingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Losing Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 100000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });
      
      const gainingAsset = createTestAccount({
        id: 'asset-2222-2222-2222-222222222222',
        name: 'Gaining Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 50000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        eligibleForCgtDiscount: true,
        startCondition: { type: 'year', year: 2020 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [losingAsset, gainingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      
      const gainEvents = year2025.taxEvents.filter(e => e.type === 'capitalGainsTax');
      expect(gainEvents.length).toBe(1);
      
      const lossCarryForward = year2025.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward).toBeUndefined();
    });

    it('partial loss offset - loss less than gain', () => {
      const smallLosingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Small Losing Asset',
        type: 'asset',
        initialValue: 40000,
        costBase: 50000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });
      
      const gainingAsset = createTestAccount({
        id: 'asset-2222-2222-2222-222222222222',
        name: 'Gaining Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 50000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        eligibleForCgtDiscount: true,
        startCondition: { type: 'year', year: 2020 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [smallLosingAsset, gainingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      
      const gainEvent = year2025.taxEvents.find(e => e.type === 'capitalGainsTax');
      expect(gainEvent).toBeDefined();
      expect(gainEvent!.assessableAmount).toBe(20000);
      
      const lossCarryForward = year2025.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward).toBeUndefined();
    });

    it('full loss offset - loss greater than gain, remainder carried forward', () => {
      const largeLosingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Large Losing Asset',
        type: 'asset',
        initialValue: 50000,
        costBase: 150000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });
      
      const gainingAsset = createTestAccount({
        id: 'asset-2222-2222-2222-222222222222',
        name: 'Gaining Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 50000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        eligibleForCgtDiscount: true,
        startCondition: { type: 'year', year: 2020 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [largeLosingAsset, gainingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      
      const gainEvent = year2025.taxEvents.find(e => e.type === 'capitalGainsTax');
      expect(gainEvent).toBeUndefined();
      
      const lossCarryForward = year2025.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward).toBeDefined();
      expect(lossCarryForward!.closing).toBe(50000);
    });

    it('loss applied before 50% CGT discount', () => {
      const losingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Losing Asset',
        type: 'asset',
        initialValue: 60000,
        costBase: 80000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });
      
      const gainingAsset = createTestAccount({
        id: 'asset-2222-2222-2222-222222222222',
        name: 'Gaining Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 50000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        eligibleForCgtDiscount: true,
        startCondition: { type: 'year', year: 2020 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [losingAsset, gainingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2026,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      
      const gainEvent = year2025.taxEvents.find(e => e.type === 'capitalGainsTax');
      expect(gainEvent).toBeDefined();
      expect(gainEvent!.assessableAmount).toBe(15000);
    });

    it('multi-year carry-forward of capital losses', () => {
      const losingAsset = createTestAccount({
        id: 'asset-1111-1111-1111-111111111111',
        name: 'Losing Asset',
        type: 'asset',
        initialValue: 60000,
        costBase: 100000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        endCondition: { type: 'year', year: 2025 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });
      
      const futureGainingAsset = createTestAccount({
        id: 'asset-2222-2222-2222-222222222222',
        name: 'Future Gaining Asset',
        type: 'asset',
        initialValue: 100000,
        costBase: 80000,
        owner: person.id,
        growthProfile: { type: 'fixed', rate: 0 },
        eligibleForCgtDiscount: true,
        startCondition: { type: 'year', year: 2020 },
        endCondition: { type: 'year', year: 2027 },
        endBehavior: 'sell',
        transferToAccountId: cashAccount.id,
      });

      const result = calculateForecast({
        accounts: [losingAsset, futureGainingAsset, cashAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2028,
      });

      const year2025 = result.years.find(y => y.year === 2025)!;
      const lossCarryForward2025 = year2025.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward2025).toBeDefined();
      expect(lossCarryForward2025!.closing).toBe(40000);
      
      const year2026 = result.years.find(y => y.year === 2026)!;
      const lossCarryForward2026 = year2026.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward2026).toBeDefined();
      expect(lossCarryForward2026!.closing).toBe(40000);
      
      const year2027 = result.years.find(y => y.year === 2027)!;
      
      const gainEvent = year2027.taxEvents.find(e => e.type === 'capitalGainsTax');
      expect(gainEvent).toBeUndefined();
      
      const lossCarryForward2027 = year2027.offBalanceSheet?.find(i => i.type === 'capitalLossCarryForward');
      expect(lossCarryForward2027).toBeDefined();
      expect(lossCarryForward2027!.closing).toBe(20000);
    });

    it('bank account with zero growth and zero return should not grow', () => {
      const bankAccount = createTestAccount({
        id: 'bank-3333-3333-3333-333333333333',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const result = calculateForecast({
        accounts: [bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2030,
      });

      // Check each year - balance should remain 300000
      for (const year of result.years) {
        const bankResult = year.accounts.find(a => a.accountId === bankAccount.id);
        expect(bankResult).toBeDefined();
        expect(bankResult!.endValue).toBe(300000);
        expect(bankResult!.growth).toBe(0);
      }
    });

    it('bank account with average balance method and zero growth should not grow', () => {
      const bankAccount = createTestAccount({
        id: 'bank-4444-4444-4444-444444444444',
        name: 'Bank Account Average',
        type: 'asset',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        returnBalanceMethod: 'average',
      });

      const result = calculateForecast({
        accounts: [bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: { ...testSettings, growthCalculationMethod: 'averageBalance' },
        startYear: 2025,
        endYear: 2030,
      });

      for (const year of result.years) {
        const bankResult = year.accounts.find(a => a.accountId === bankAccount.id);
        expect(bankResult).toBeDefined();
        expect(bankResult!.endValue).toBe(300000);
        expect(bankResult!.growth).toBe(0);
      }
    });

    it('bank account with return rate of 0 should not generate income', () => {
      const incomeAccount = createTestAccount({
        id: 'income-4444-4444-4444-444444444444',
        name: 'Test Income',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-5555-5555-5555-555555555555',
      });

      const bankAccount = createTestAccount({
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 300000,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0,
        incomeTargetAccountId: 'income-4444-4444-4444-444444444444',
      });

      const result = calculateForecast({
        accounts: [bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2030,
      });

      for (const year of result.years) {
        const bankResult = year.accounts.find(a => a.accountId === bankAccount.id);
        expect(bankResult).toBeDefined();
        // With returnRate = 0, no income should be generated
        expect(bankResult!.endValue).toBe(300000);
      }
    });

    it('forwards investment returns through an income account to its depositsToAccountId', () => {
      const incomeAccount = createTestAccount({
        id: 'income-4444-4444-4444-444444444444',
        name: 'Investment Income',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-5555-5555-5555-555555555555',
      });

      const bankAccount = createTestAccount({
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        incomeTargetAccountId: 'income-4444-4444-4444-444444444444',
      });

      const result = calculateForecast({
        accounts: [bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      // Year 1: bank 100,000 * 10% = 10,000 return
      const year2025 = result.years[0];
      const income2025 = year2025.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bank2025 = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(income2025.endValue).toBe(10000);
      expect(bank2025.endValue).toBe(110000);

      // Year 2: bank 110,000 * 10% = 11,000 return
      const year2026 = result.years[1];
      const income2026 = year2026.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bank2026 = year2026.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(income2026.endValue).toBe(11000);
      expect(bank2026.endValue).toBe(121000);

      // Year 3: bank 121,000 * 10% = 12,100 return
      const year2027 = result.years[2];
      const income2027 = year2027.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bank2027 = year2027.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(income2027.endValue).toBe(12100);
      expect(bank2027.endValue).toBe(133100);
    });

    it('calculates returns on event-inflated balance when opening balance is zero (regression)', () => {
      // Bug: returns were skipped when balanceForGrowth was zero even if endValue was large.
      // This happens when an asset receives a large assetChange event but starts the year at $0.
      const incomeAccount = createTestAccount({
        id: 'income-event-1111-1111-1111-111111111111',
        name: 'Investment Income',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-event-1111-1111-1111-111111111111',
      });

      const bankAccount = createTestAccount({
        id: 'bank-event-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        returnBalanceMethod: 'closing',
        incomeTargetAccountId: 'income-event-1111-1111-1111-111111111111',
      });

      // House sale event: credit bank with $1,000,000
      const houseSaleEvent: Event = {
        id: 'event-house-sale-000000000000',
        year: 2025,
        type: 'assetChange',
        description: 'House sale proceeds',
        amount: 1000000,
        affectedAccountId: bankAccount.id,
      };

      const result = calculateForecast({
        accounts: [bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [houseSaleEvent],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const incomeResult = year2025.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;

      // Bank: opening 0 + event 1,000,000 + return 100,000 = 1,100,000
      expect(bankResult.endValue).toBe(1100000);
      // Income: return = 10% of 1,000,000 = 100,000
      expect(incomeResult.endValue).toBe(100000);
    });

    it('deposits investment returns to the bank account in the same year (exact user scenario)', () => {
      // Exact scenario: asset $100, 10% return, targets income account,
      // income account deposits to a separate bank account
      const investmentReturns = createTestAccount({
        id: 'income-ret-1111-1111-1111-111111111111',
        name: 'Investment Returns',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-2222-2222-2222-222222222222',
      });

      const bankAccount = createTestAccount({
        id: 'bank-2222-2222-2222-222222222222',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const assetAccount = createTestAccount({
        id: 'asset-3333-3333-3333-333333333333',
        name: 'Investment Asset',
        type: 'asset',
        initialValue: 100,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        incomeTargetAccountId: 'income-ret-1111-1111-1111-111111111111',
      });

      const result = calculateForecast({
        accounts: [assetAccount, investmentReturns, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const incomeResult = year2025.accounts.find((a) => a.accountId === investmentReturns.id)!;
      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;
      const assetResult = year2025.accounts.find((a) => a.accountId === assetAccount.id)!;

      // Income account should show the return
      expect(incomeResult.endValue).toBe(10);

      // Bank account should receive the return (50 + 10 = 60)
      expect(bankResult.endValue).toBe(60);

      // Asset should still be 100 (return is income, not capital growth)
      expect(assetResult.endValue).toBe(100);
    });

    it('forwards investment returns when income account also has its own income', () => {
      const salaryAccount = createTestAccount({
        id: 'income-salary-4444-4444-4444-444444444444',
        name: 'Salary',
        type: 'income',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-5555-5555-5555-555555555555',
      });

      const dividendAccount = createTestAccount({
        id: 'income-div-4444-4444-4444-444444444444',
        name: 'Dividends',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-5555-5555-5555-555555555555',
      });

      const bankAccount = createTestAccount({
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 200000,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        incomeTargetAccountId: 'income-div-4444-4444-4444-444444444444',
      });

      const result = calculateForecast({
        accounts: [bankAccount, salaryAccount, dividendAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      // Year 1: bank return includes salary inflow (average balance = 250k)
      const year2025 = result.years[0];
      const salary2025 = year2025.accounts.find((a) => a.accountId === salaryAccount.id)!;
      const div2025 = year2025.accounts.find((a) => a.accountId === dividendAccount.id)!;
      const bank2025 = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;

      expect(salary2025.endValue).toBe(100000);
      // Return calculated on average balance including salary: (200k + 300k)/2 * 10% = 25k
      expect(div2025.endValue).toBe(25000);
      // Bank: 200,000 + 100,000 (salary) + 25,000 (return) = 325,000
      expect(bank2025.endValue).toBe(325000);

      // Year 2: bank return includes salary inflow (average balance = 375k)
      const year2026 = result.years[1];
      const salary2026 = year2026.accounts.find((a) => a.accountId === salaryAccount.id)!;
      const div2026 = year2026.accounts.find((a) => a.accountId === dividendAccount.id)!;
      const bank2026 = year2026.accounts.find((a) => a.accountId === bankAccount.id)!;

      expect(salary2026.endValue).toBe(100000);
      // Return calculated on average balance including salary: (325k + 425k)/2 * 10% = 37.5k
      expect(div2026.endValue).toBe(37500);
      // Bank: 325,000 + 100,000 (salary) + 37,500 (return) = 462,500
      expect(bank2026.endValue).toBe(462500);
    });

    it('warns when incomeTargetAccountId points to a non-income account (stale data)', () => {
      const bankAccount = createTestAccount({
        id: 'bank-4444-4444-4444-444444444444',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const assetAccount = createTestAccount({
        id: 'asset-5555-5555-5555-555555555555',
        name: 'Investment Asset',
        type: 'asset',
        initialValue: 100,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        incomeTargetAccountId: 'bank-4444-4444-4444-444444444444', // Stale: targets an asset
      });

      const result = calculateForecast({
        accounts: [assetAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const warning = year2025.warnings?.find(
        (w) => w.type === 'other' && w.message.includes('Bank Account')
      );
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
      expect(warning!.message).toContain('asset account');
    });

    it('forwards investment returns with closing balance method', () => {
      const incomeAccount = createTestAccount({
        id: 'income-4444-4444-4444-444444444444',
        name: 'Investment Income',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-5555-5555-5555-555555555555',
      });

      const bankAccount = createTestAccount({
        id: 'bank-5555-5555-5555-555555555555',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 },
        returnRate: 0.10,
        returnBalanceMethod: 'closing',
        incomeTargetAccountId: 'income-4444-4444-4444-444444444444',
      });

      const result = calculateForecast({
        accounts: [bankAccount, incomeAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      const year2025 = result.years[0];
      const income2025 = year2025.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bank2025 = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(income2025.endValue).toBe(10000);
      expect(bank2025.endValue).toBe(110000);

      const year2026 = result.years[1];
      const income2026 = year2026.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bank2026 = year2026.accounts.find((a) => a.accountId === bankAccount.id)!;
      expect(income2026.endValue).toBe(11000);
      expect(bank2026.endValue).toBe(121000);
    });

    it('applies minimum drawdown for allocated pension at age under 65 (4%)', () => {
      const person: Person = {
        id: 'person-6666-6666-6666-666666666666',
        name: 'Test Person',
        birthYear: 2000, // Age 25 in 2025
      };

      const pensionAccount = createTestAccount({
        id: 'pension-6666-6666-6666-666666666666',
        name: 'Allocated Pension',
        type: 'asset',
        assetSubType: 'allocatedPension',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: person.id,
      });

      const result = calculateForecast({
        accounts: [pensionAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const pensionResult = year2025.accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Minimum drawdown for age under 65 = 4% of 500000 = 20000
      // Since there are no other withdrawals, the minimum drawdown should be applied
      expect(pensionResult.withdrawals).toBe(20000);
      expect(pensionResult.endValue).toBe(480000);
    });

    it('applies minimum drawdown for allocated pension at age 70 (5%)', () => {
      const person: Person = {
        id: 'person-7777-7777-7777-777777777777',
        name: 'Test Person',
        birthYear: 1955, // Age 70 in 2025
      };

      const pensionAccount = createTestAccount({
        id: 'pension-7777-7777-7777-777777777777',
        name: 'Allocated Pension',
        type: 'asset',
        assetSubType: 'allocatedPension',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: person.id,
      });

      const result = calculateForecast({
        accounts: [pensionAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const pensionResult = year2025.accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Minimum drawdown for age 65-74 = 5% of 500000 = 25000
      expect(pensionResult.withdrawals).toBe(25000);
      expect(pensionResult.endValue).toBe(475000);
    });

    it('does not apply minimum drawdown when withdrawals already exceed minimum', () => {
      const person: Person = {
        id: 'person-8888-8888-8888-888888888888',
        name: 'Test Person',
        birthYear: 1955, // Age 70 in 2025
      };

      const pensionAccount = createTestAccount({
        id: 'pension-8888-8888-8888-888888888888',
        name: 'Allocated Pension',
        type: 'asset',
        assetSubType: 'allocatedPension',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: person.id,
      });

      const expenseAccount = createTestAccount({
        id: 'expense-8888-8888-8888-888888888888',
        name: 'Living Expenses',
        type: 'expense',
        initialValue: 60000, // 60k withdrawal > 25k minimum
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: 'pension-8888-8888-8888-888888888888',
      });

      const result = calculateForecast({
        accounts: [pensionAccount, expenseAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const pensionResult = year2025.accounts.find(a => a.accountId === pensionAccount.id)!;
      
      // Withdrawal is 60000, which exceeds minimum of 25000, so no additional drawdown
      expect(pensionResult.withdrawals).toBe(60000);
      expect(pensionResult.endValue).toBe(440000);
    });

    it('deposits minimum drawdown to the pension incomeTargetAccountId', () => {
      const person: Person = {
        id: 'person-9999-9999-9999-999999999999',
        name: 'Test Person',
        birthYear: 1955, // Age 70 in 2025
      };

      const bankAccount = createTestAccount({
        id: 'bank-9999-9999-9999-999999999999',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const pensionAccount = createTestAccount({
        id: 'pension-9999-9999-9999-999999999999',
        name: 'Allocated Pension',
        type: 'asset',
        assetSubType: 'allocatedPension',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: person.id,
        incomeTargetAccountId: bankAccount.id, // Drawdown deposits here
      });

      const result = calculateForecast({
        accounts: [pensionAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const pensionResult = year2025.accounts.find(a => a.accountId === pensionAccount.id)!;
      const bankResult = year2025.accounts.find(a => a.accountId === bankAccount.id)!;

      // Minimum drawdown for age 65-74 = 5% of 500000 = 25000
      expect(pensionResult.withdrawals).toBe(25000);
      expect(pensionResult.endValue).toBe(475000);

      // The drawdown should be deposited to the bank account
      expect(bankResult.contributions).toBe(25000);
      expect(bankResult.endValue).toBe(75000); // 50000 + 25000

      // Cashflow details should exist on both sides
      expect(pensionResult.cashflowDetails).toBeDefined();
      expect(pensionResult.cashflowDetails!.length).toBe(1);
      expect(pensionResult.cashflowDetails![0].type).toBe('withdrawal');
      expect(pensionResult.cashflowDetails![0].amount).toBe(25000);

      expect(bankResult.cashflowDetails).toBeDefined();
      expect(bankResult.cashflowDetails!.length).toBe(1);
      expect(bankResult.cashflowDetails![0].type).toBe('contribution');
      expect(bankResult.cashflowDetails![0].amount).toBe(25000);
      expect(bankResult.cashflowDetails![0].sourceAccountId).toBe(pensionAccount.id);
    });

    it('forwards pension drawdown through an income account to its depositsToAccountId', () => {
      const person: Person = {
        id: 'person-draw-1111-1111-1111-111111111111',
        name: 'Test Person',
        birthYear: 1955, // Age 70 in 2025
      };

      const incomeAccount = createTestAccount({
        id: 'income-draw-1111-1111-1111-111111111111',
        name: 'Pension Income',
        type: 'income',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        depositsToAccountId: 'bank-draw-1111-1111-1111-111111111111',
      });

      const bankAccount = createTestAccount({
        id: 'bank-draw-1111-1111-1111-111111111111',
        name: 'Bank Account',
        type: 'asset',
        initialValue: 50000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const pensionAccount = createTestAccount({
        id: 'pension-draw-1111-1111-1111-111111111111',
        name: 'Allocated Pension',
        type: 'asset',
        assetSubType: 'allocatedPension',
        initialValue: 500000,
        growthProfile: { type: 'fixed', rate: 0 },
        owner: person.id,
        incomeTargetAccountId: 'income-draw-1111-1111-1111-111111111111',
      });

      const result = calculateForecast({
        accounts: [pensionAccount, incomeAccount, bankAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [person],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const pensionResult = year2025.accounts.find((a) => a.accountId === pensionAccount.id)!;
      const incomeResult = year2025.accounts.find((a) => a.accountId === incomeAccount.id)!;
      const bankResult = year2025.accounts.find((a) => a.accountId === bankAccount.id)!;

      // Minimum drawdown for age 65-74 = 5% of 500000 = 25000
      expect(pensionResult.withdrawals).toBe(25000);
      expect(pensionResult.endValue).toBe(475000);

      // Income account should receive the drawdown
      expect(incomeResult.endValue).toBe(25000);

      // Bank should receive the drawdown via the income account's depositsToAccountId
      expect(bankResult.endValue).toBe(75000); // 50000 + 25000

      // Cashflow details should exist on all three accounts
      expect(pensionResult.cashflowDetails).toBeDefined();
      expect(pensionResult.cashflowDetails!.length).toBe(1);
      expect(pensionResult.cashflowDetails![0].type).toBe('withdrawal');
      expect(pensionResult.cashflowDetails![0].amount).toBe(25000);

      expect(incomeResult.cashflowDetails).toBeDefined();
      expect(incomeResult.cashflowDetails!.length).toBe(1);
      expect(incomeResult.cashflowDetails![0].type).toBe('contribution');
      expect(incomeResult.cashflowDetails![0].amount).toBe(25000);

      expect(bankResult.cashflowDetails).toBeDefined();
      expect(bankResult.cashflowDetails!.length).toBe(1);
      expect(bankResult.cashflowDetails![0].type).toBe('contribution');
      expect(bankResult.cashflowDetails![0].amount).toBe(25000);
      expect(bankResult.cashflowDetails![0].sourceAccountId).toBe(pensionAccount.id);
    });

    it('self-targeting returns appear in contributions total', () => {
      // Asset that generates returns to itself should show those returns in contributions
      // Note: self-targeting requires returnRate (not growthRate) + incomeTargetAccountId pointing to self
      const assetAccount = createTestAccount({
        id: 'asset-self-9999-9999-9999-999999999999',
        name: 'Self-Targeting Asset',
        type: 'asset',
        initialValue: 100000,
        growthProfile: { type: 'fixed', rate: 0 }, // No capital growth
        returnRate: 0.10, // 10% return (income generated)
        incomeTargetAccountId: 'asset-self-9999-9999-9999-999999999999', // Target = self
      });

      const result = calculateForecast({
        accounts: [assetAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2025,
      });

      const year2025 = result.years[0];
      const assetResult = year2025.accounts.find(a => a.accountId === assetAccount.id)!;
      
      // With average balance method (default), return should be ~10% of average = ~10% of 105000 = 10500
      // Contributions should include the self-targeting return
      expect(assetResult.contributions).toBeGreaterThan(0);
      expect(assetResult.contributions).toBe(assetResult.endValue - 100000 + assetResult.withdrawals);
      
      // Verify cashflow detail exists
      const cashflowDetails = assetResult.cashflowDetails ?? [];
      const returnDetail = cashflowDetails.find(d => d.type === 'contribution' && d.description.includes('Return'));
      expect(returnDetail).toBeDefined();
      expect(returnDetail!.amount).toBe(assetResult.contributions);
    });
  });

  // ============================================================
  // Transaction integrity — ledger and conservation checks
  // ============================================================

  describe('transaction integrity', () => {
    describe('pension drawdown with drawnFromAccountId', () => {
      it('debits the pension account and credits cash when drawnFromAccountId is set', () => {
        const pensionAccount = createTestAccount({
          id: 'pension-1111-1111-1111-111111111111',
          name: 'Allocated Pension',
          type: 'asset',
          initialValue: 200_000,
          growthProfile: { type: 'fixed', rate: 0.05 },
          incomeTaxTreatment: 'taxFree',
        });

        const cashAccount = createTestAccount({
          id: 'cash-1111-1111-1111-111111111111',
          name: 'Cash',
          type: 'asset',
          initialValue: 10_000,
          growthProfile: { type: 'fixed', rate: 0 },
        });

        // Income account that models the pension drawdown
        const drawdownAccount = createTestAccount({
          id: 'drawdown-1111-1111-1111-111111111111',
          name: 'Pension Income',
          type: 'income',
          initialValue: 30_000,
          growthProfile: { type: 'fixed', rate: 0 },
          incomeTaxTreatment: 'taxFree',
          depositsToAccountId: cashAccount.id,
          drawnFromAccountId: pensionAccount.id,
        });

        const result = calculateForecast({
          accounts: [pensionAccount, cashAccount, drawdownAccount],
          assumptions: defaultAssumptions,
          epochs: defaultEpochs,
          events: [],
          persons: [],
          settings: testSettings,
          startYear: 2025,
          endYear: 2025,
        });

        const year = result.years[0];

        const pensionResult = year.accounts.find(a => a.accountId === pensionAccount.id)!;
        const cashResult    = year.accounts.find(a => a.accountId === cashAccount.id)!;

        // Growth applied after drawdown (average balance method)
        const pensionAfterDrawdown = 200_000 - 30_000;
        const averageBalance = (200_000 + pensionAfterDrawdown) / 2;
        const growth = averageBalance * 0.05;
        expect(pensionResult.endValue).toBeCloseTo(pensionAfterDrawdown + growth, 0);
        expect(pensionResult.transfers).toBe(-30_000);

        // Cash receives the drawdown
        expect(cashResult.endValue).toBeCloseTo(10_000 + 30_000, 0);
        expect(cashResult.transfers).toBe(30_000);

        // No conservation violation
        const violations = year.warnings?.filter(w => w.type === 'conservationViolation') ?? [];
        expect(violations).toHaveLength(0);
      });

      it('does NOT debit the pension account when drawnFromAccountId is absent (demonstrates the old bug)', () => {
        const pensionAccount = createTestAccount({
          id: 'pension-2222-2222-2222-222222222222',
          name: 'Allocated Pension',
          type: 'asset',
          initialValue: 200_000,
          growthProfile: { type: 'fixed', rate: 0 },
        });

        const cashAccount = createTestAccount({
          id: 'cash-2222-2222-2222-222222222222',
          name: 'Cash',
          type: 'asset',
          initialValue: 10_000,
          growthProfile: { type: 'fixed', rate: 0 },
        });

        // No drawnFromAccountId — treated as external income (the old broken model)
        const drawdownAccount = createTestAccount({
          id: 'drawdown-2222-2222-2222-222222222222',
          name: 'Pension Income',
          type: 'income',
          initialValue: 30_000,
          growthProfile: { type: 'fixed', rate: 0 },
          incomeTaxTreatment: 'taxFree',
          depositsToAccountId: cashAccount.id,
          // drawnFromAccountId NOT set
        });

        const result = calculateForecast({
          accounts: [pensionAccount, cashAccount, drawdownAccount],
          assumptions: defaultAssumptions,
          epochs: defaultEpochs,
          events: [],
          persons: [],
          settings: testSettings,
          startYear: 2025,
          endYear: 2025,
        });

        const year = result.years[0];
        const pensionResult = year.accounts.find(a => a.accountId === pensionAccount.id)!;
        const cashResult    = year.accounts.find(a => a.accountId === cashAccount.id)!;

        // Pension balance unchanged — the bug: money appears in cash without leaving pension
        expect(pensionResult.endValue).toBe(200_000);
        expect(pensionResult.withdrawals).toBe(0);

        // Cash still grows (the externalIn credit goes through), creating money from thin air
        expect(cashResult.contributions).toBe(30_000);
      });
    });

    describe('ledger error on missing destination account', () => {
      it('emits a ledgerError warning when depositsToAccountId references a non-existent account', () => {
        const incomeAccount = createTestAccount({
          id: 'income-3333-3333-3333-333333333333',
          name: 'Salary',
          type: 'income',
          initialValue: 100_000,
          growthProfile: { type: 'fixed', rate: 0 },
          depositsToAccountId: 'does-not-exist-at-all-000000000',
        });

        const result = calculateForecast({
          accounts: [incomeAccount],
          assumptions: defaultAssumptions,
          epochs: defaultEpochs,
          events: [],
          persons: [],
          settings: testSettings,
          startYear: 2025,
          endYear: 2025,
        });

        const year = result.years[0];
        const ledgerErrors = year.warnings?.filter(w => w.type === 'ledgerError') ?? [];
        expect(ledgerErrors.length).toBeGreaterThan(0);
        expect(ledgerErrors[0].message).toContain('does-not-exist-at-all-000000000');
      });
    });

    describe('auto-topup transfer balance', () => {
      it('debits source and credits target by equal amounts with no conservation violation', () => {
        const emergencyFund = createTestAccount({
          id: 'emergency-4444-4444-4444-444444444444',
          name: 'Emergency Fund',
          type: 'asset',
          initialValue: 0,
          growthProfile: { type: 'fixed', rate: 0 },
          autoTopup: {
            enabled: true,
            threshold: 20_000,
            fromAccountIds: ['bank-4444-4444-4444-444444444444'],
            targetBalance: 20_000,
          },
        });

        const bankAccount = createTestAccount({
          id: 'bank-4444-4444-4444-444444444444',
          name: 'Bank',
          type: 'asset',
          initialValue: 100_000,
          growthProfile: { type: 'fixed', rate: 0 },
        });

        const result = calculateForecast({
          accounts: [emergencyFund, bankAccount],
          assumptions: defaultAssumptions,
          epochs: defaultEpochs,
          events: [],
          persons: [],
          settings: testSettings,
          startYear: 2025,
          endYear: 2025,
        });

        const year = result.years[0];
        const fundResult = year.accounts.find(a => a.accountId === emergencyFund.id)!;
        const bankResult = year.accounts.find(a => a.accountId === bankAccount.id)!;

        expect(fundResult.endValue).toBe(20_000);
        expect(fundResult.transfers).toBe(20_000);
        expect(bankResult.endValue).toBe(80_000);
        expect(bankResult.transfers).toBe(-20_000);

        // Transfer is balanced — no conservation violation
        const violations = year.warnings?.filter(w => w.type === 'conservationViolation') ?? [];
        expect(violations).toHaveLength(0);
      });
    });

    describe('income to expense flow conservation', () => {
      it('salary deposited to bank and expense drawn from bank produces no conservation violation', () => {
        const bankAccount = createTestAccount({
          id: 'bank-5555-5555-5555-555555555555',
          name: 'Bank',
          type: 'asset',
          initialValue: 50_000,
          growthProfile: { type: 'fixed', rate: 0 },
        });

        const salaryAccount = createTestAccount({
          id: 'salary-5555-5555-5555-555555555555',
          name: 'Salary',
          type: 'income',
          initialValue: 100_000,
          growthProfile: { type: 'fixed', rate: 0 },
          depositsToAccountId: bankAccount.id,
        });

        const expenseAccount = createTestAccount({
          id: 'expense-5555-5555-5555-555555555555',
          name: 'Living Expenses',
          type: 'expense',
          initialValue: 60_000,
          growthProfile: { type: 'fixed', rate: 0 },
          fundedByAccountId: bankAccount.id,
        });

        const result = calculateForecast({
          accounts: [bankAccount, salaryAccount, expenseAccount],
          assumptions: defaultAssumptions,
          epochs: defaultEpochs,
          events: [],
          persons: [],
          settings: testSettings,
          startYear: 2025,
          endYear: 2025,
        });

        const year = result.years[0];
        const bankResult = year.accounts.find(a => a.accountId === bankAccount.id)!;

        // Bank: +salary −expenses
        expect(bankResult.endValue).toBe(50_000 + 100_000 - 60_000);
        expect(bankResult.contributions).toBe(100_000);
        expect(bankResult.withdrawals).toBe(60_000);

        const violations = year.warnings?.filter(w => w.type === 'conservationViolation') ?? [];
        expect(violations).toHaveLength(0);
      });
    });
  });

  describe('account reconciliation and fundedBy verification', () => {
    it('does not emit reconciliation warnings for a complex valid scenario', () => {
      const bankAccount = createTestAccount({
        id: 'bank-9999-9999-9999-999999999999',
        name: 'Bank',
        type: 'asset',
        initialValue: 100_000,
        growthProfile: { type: 'fixed', rate: 0.04 },
      });

      const houseAccount = createTestAccount({
        id: 'house-9999-9999-9999-999999999999',
        name: 'House',
        type: 'asset',
        initialValue: 500_000,
        growthProfile: { type: 'fixed', rate: 0.03 },
        fundedByAccountId: bankAccount.id,
        startCondition: { type: 'year', year: 2025 },
      });

      const salaryAccount = createTestAccount({
        id: 'salary-9999-9999-9999-999999999999',
        name: 'Salary',
        type: 'income',
        initialValue: 80_000,
        growthProfile: { type: 'fixed', rate: 0.02 },
        depositsToAccountId: bankAccount.id,
      });

      const expenseAccount = createTestAccount({
        id: 'expense-9999-9999-9999-999999999999',
        name: 'Expenses',
        type: 'expense',
        initialValue: 40_000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
      });

      const mortgageAccount = createTestAccount({
        id: 'mortgage-9999-9999-9999-999999999999',
        name: 'Mortgage',
        type: 'liability',
        initialValue: 300_000,
        growthProfile: { type: 'fixed', rate: 0 },
        interestRate: 0.05,
        annualPayment: 20_000,
        fundedByAccountId: bankAccount.id,
      });

      const result = calculateForecast({
        accounts: [bankAccount, houseAccount, salaryAccount, expenseAccount, mortgageAccount],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [defaultPerson],
        settings: testSettings,
        startYear: 2025,
        endYear: 2030,
      });

      for (const year of result.years) {
        const reconciliationWarnings = year.warnings?.filter(
          (w) => w.type === 'other' && w.message?.includes('reconciliation failed'),
        ) ?? [];
        expect(reconciliationWarnings).toHaveLength(0);
      }
    });

    it('emits fundedBy completeness warning when asset purchase is not recorded in funding account', () => {
      const bankAccount = createTestAccount({
        id: 'bank-7777-7777-7777-777777777777',
        name: 'Bank',
        type: 'asset',
        initialValue: 1_000_000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      // This asset has fundedByAccountId but initialValue = 0 and no events,
      // so fundingAmount = 0 and no "Fund asset" entry is created.
      // The completeness check should flag it in the first active year.
      const zeroValueAsset = createTestAccount({
        id: 'zero-7777-7777-7777-777777777777',
        name: 'Zero Value Asset',
        type: 'asset',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
        startCondition: { type: 'year', year: 2026 },
      });

      const result = calculateForecast({
        accounts: [bankAccount, zeroValueAsset],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      // 2025: asset not active yet — no warning
      const year2025 = result.years.find((y) => y.year === 2025)!;
      const warning2025 = year2025.warnings?.filter(
        (w) => w.type === 'other' && w.message?.includes('Zero Value Asset'),
      ) ?? [];
      expect(warning2025).toHaveLength(0);

      // 2026: first active year — fundedBy completeness warning should fire
      const year2026 = result.years.find((y) => y.year === 2026)!;
      const warning2026 = year2026.warnings?.filter(
        (w) => w.type === 'other' && w.message?.includes('Zero Value Asset'),
      ) ?? [];
      expect(warning2026).toHaveLength(1);
      expect(warning2026[0].severity).toBe('error');
      expect(warning2026[0].message).toContain('no funding transaction was recorded');
      expect(warning2026[0].accountId).toBe(zeroValueAsset.id);

      // 2027: not the first active year — no warning
      const year2027 = result.years.find((y) => y.year === 2027)!;
      const warning2027 = year2027.warnings?.filter(
        (w) => w.type === 'other' && w.message?.includes('Zero Value Asset'),
      ) ?? [];
      expect(warning2027).toHaveLength(0);
    });

    it('does not emit fundedBy warning when funding is properly recorded', () => {
      const bankAccount = createTestAccount({
        id: 'bank-6666-6666-6666-666666666666',
        name: 'Bank',
        type: 'asset',
        initialValue: 1_000_000,
        growthProfile: { type: 'fixed', rate: 0 },
      });

      const fundedAsset = createTestAccount({
        id: 'asset-6666-6666-6666-666666666666',
        name: 'Funded Asset',
        type: 'asset',
        initialValue: 200_000,
        growthProfile: { type: 'fixed', rate: 0 },
        fundedByAccountId: bankAccount.id,
        startCondition: { type: 'year', year: 2026 },
      });

      const result = calculateForecast({
        accounts: [bankAccount, fundedAsset],
        assumptions: defaultAssumptions,
        epochs: defaultEpochs,
        events: [],
        persons: [],
        settings: testSettings,
        startYear: 2025,
        endYear: 2027,
      });

      // 2026: first active year, funding should be recorded
      const year2026 = result.years.find((y) => y.year === 2026)!;
      const bankResult = year2026.accounts.find((a) => a.accountId === bankAccount.id)!;
      const fundedByEntry = bankResult.cashflowDetails?.find(
        (d) => d.description === 'Fund asset: Funded Asset',
      );
      expect(fundedByEntry).toBeDefined();
      expect(fundedByEntry?.amount).toBe(200_000);
      expect(fundedByEntry?.type).toBe('transfer');

      // No fundedBy completeness warning
      const warnings = year2026.warnings?.filter(
        (w) => w.type === 'other' && w.message?.includes('Funded Asset'),
      ) ?? [];
      expect(warnings).toHaveLength(0);

      // Bank balance should be reduced by the purchase
      expect(bankResult.endValue).toBe(800_000);
    });
  });
});
