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
  yearsSinceStart: number = 1,
  epochGrowthParamOverride?: number
): number {
  const growthRate = calculateGrowthRate(
    account.growthProfile,
    assumptions,
    yearsSinceStart,
    epochGrowthParamOverride
  );

  return previousValue * (1 + growthRate);
}

function calculateGrowthRate(
  profile: GrowthProfile,
  assumptions: ResolvedAssumptions,
  yearsSinceStart: number,
  epochParamOverride?: number
): number {
  switch (profile.type) {
    case 'fixed':
      return epochParamOverride ?? profile.rate;

    case 'cpiLinked': {
      const value = epochParamOverride ?? profile.value ?? 0;
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

    case 'increasing': {
      const baseRate = epochParamOverride ?? profile.rate;
      return baseRate + (profile.changePerYear ?? 0.005) * (yearsSinceStart - 1);
    }

    case 'decreasing': {
      const baseRate = epochParamOverride ?? profile.rate;
      return Math.max(0, baseRate - (profile.changePerYear ?? 0.005) * (yearsSinceStart - 1));
    }

    default:
      return 0;
  }
}

export interface TransferResult {
  isTransferYear: boolean;
  amount: number;
  destinationId?: string;
  endBehavior?: 'transfer' | 'sell' | 'sellNoCgt';
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

  if (account.endBehavior !== 'transfer' && account.endBehavior !== 'sell' && account.endBehavior !== 'sellNoCgt') {
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
