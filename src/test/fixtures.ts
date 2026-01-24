import type { Account, Person, AssumptionProfile, ResolvedAssumptions } from '../schemas';

export const samplePersons: Person[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Alice',
    birthYear: 1970,
    retirementYear: 2035,
    preservationAge: 60,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Bob',
    birthYear: 1975,
    retirementYear: 2040,
    preservationAge: 60,
  },
];

export const sampleAccounts: Account[] = [
  {
    id: 'aaaa1111-1111-1111-1111-111111111111',
    name: 'Salary Income',
    type: 'income',
    owner: '11111111-1111-1111-1111-111111111111',
    initialValue: 100000,
    growthProfile: { type: 'fixed', rate: 0.03 },
  },
  {
    id: 'aaaa2222-2222-2222-2222-222222222222',
    name: 'Living Expenses',
    type: 'expense',
    owner: '11111111-1111-1111-1111-111111111111',
    initialValue: 50000,
    growthProfile: { type: 'cpiLinked', offset: 0.005 },
  },
  {
    id: 'aaaa3333-3333-3333-3333-333333333333',
    name: 'Super Account',
    type: 'asset',
    owner: '11111111-1111-1111-1111-111111111111',
    initialValue: 500000,
    growthProfile: { type: 'fixed', rate: 0.06 },
    startCondition: { type: 'year', year: 2024 },
    endCondition: { type: 'age', personId: '11111111-1111-1111-1111-111111111111', age: 65 },
  },
  {
    id: 'aaaa4444-4444-4444-4444-444444444444',
    name: 'Investment Portfolio',
    type: 'asset',
    owner: '22222222-2222-2222-2222-222222222222',
    initialValue: 200000,
    growthProfile: { type: 'fixed', rate: 0.08 },
  },
  {
    id: 'aaaa5555-5555-5555-5555-555555555555',
    name: 'Pension Account',
    type: 'asset',
    owner: '11111111-1111-1111-1111-111111111111',
    initialValue: 100000,
    growthProfile: { type: 'fixed', rate: 0.05 },
    endCondition: { type: 'year', year: 2040 },
    endBehavior: 'transfer',
    transferToAccountId: 'aaaa6666-6666-6666-6666-666666666666',
  },
  {
    id: 'aaaa6666-6666-6666-6666-666666666666',
    name: 'Savings Account',
    type: 'asset',
    initialValue: 50000,
    growthProfile: { type: 'fixed', rate: 0.02 },
  },
];

export const sampleAssumptionProfile: AssumptionProfile = {
  baseValue: 0.025,
  overrides: {
    '2025': 0.03,
    '2026': 0.028,
  },
};

export const sampleAssumptionProfileWithFormula: AssumptionProfile = {
  baseValue: 0.04,
  formula: 'CPI+1',
};

export const sampleResolvedAssumptions: ResolvedAssumptions = {
  cpi: 0.025,
  investmentGrowth: 0.06,
  superGrowth: 0.07,
};
