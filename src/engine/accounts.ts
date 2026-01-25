import type { Account, Person, ResolvedAssumptions, GrowthProfile, AccountCondition } from '../schemas';

export function isAccountActive(
  account: Account,
  year: number,
  persons: Person[]
): boolean {
  const owner = persons.find((p) => p.id === account.owner);

  if (account.startCondition) {
    const startYear = conditionToYear(account.startCondition, owner);
    if (year < startYear) {
      return false;
    }
  }

  if (account.endCondition) {
    const endYear = conditionToYear(account.endCondition, owner);
    if (year > endYear) {
      return false;
    }
  }

  return true;
}

function conditionToYear(
  condition: AccountCondition,
  owner?: Person
): number {
  if (condition.type === 'year') {
    return condition.year;
  }

  if (condition.type === 'age' && owner) {
    return owner.birthYear + condition.age;
  }

  return 0;
}

export function projectAccountValue(
  account: Account,
  _year: number,
  previousValue: number,
  assumptions: ResolvedAssumptions,
  yearsSinceStart: number = 1
): number {
  const growthRate = calculateGrowthRate(
    account.growthProfile,
    assumptions,
    yearsSinceStart
  );

  return previousValue * (1 + growthRate);
}

function calculateGrowthRate(
  profile: GrowthProfile,
  assumptions: ResolvedAssumptions,
  yearsSinceStart: number
): number {
  switch (profile.type) {
    case 'fixed':
      return profile.rate;

    case 'cpiLinked': {
      const value = profile.value ?? 0;
      switch (profile.operation) {
        case 'add':
          return assumptions.cpi + value;
        case 'subtract':
          return assumptions.cpi - value;
        case 'multiply':
          return assumptions.cpi * value;
        default:
          return assumptions.cpi + value;
      }
    }

    case 'increasing':
      return profile.rate + (profile.changePerYear ?? 0.005) * (yearsSinceStart - 1);

    case 'decreasing':
      return Math.max(0, profile.rate - (profile.changePerYear ?? 0.005) * (yearsSinceStart - 1));

    default:
      return 0;
  }
}

export interface TransferResult {
  isTransferYear: boolean;
  amount: number;
  destinationId?: string;
  endBehavior?: 'transfer' | 'sell';
}

export function handleAccountTransfer(
  account: Account,
  year: number,
  persons: Person[],
  currentValue: number
): TransferResult {
  if (!account.endCondition || !account.transferToAccountId) {
    return { isTransferYear: false, amount: 0 };
  }

  if (account.endBehavior !== 'transfer' && account.endBehavior !== 'sell') {
    return { isTransferYear: false, amount: 0 };
  }

  const owner = persons.find((p) => p.id === account.owner);
  const endYear = conditionToYear(account.endCondition, owner);

  if (year !== endYear) {
    return { isTransferYear: false, amount: 0 };
  }

  return {
    isTransferYear: true,
    amount: currentValue,
    destinationId: account.transferToAccountId,
    endBehavior: account.endBehavior,
  };
}

export function getAccountEndYear(account: Account, persons: Person[]): number | undefined {
  if (!account.endCondition) {
    return undefined;
  }
  const owner = persons.find((p) => p.id === account.owner);
  return conditionToYear(account.endCondition, owner);
}

export function getAccountAcquisitionYear(account: Account, persons: Person[]): number {
  if (account.acquisitionYear) {
    return account.acquisitionYear;
  }
  if (account.startCondition) {
    const owner = persons.find((p) => p.id === account.owner);
    return conditionToYear(account.startCondition, owner);
  }
  return new Date().getFullYear();
}
