import { describe, it, expect } from 'vitest';
import {
  getCapsForYear,
  calculateAvailableCarryForward,
  consumeCarryForward,
  processPersonContributions,
  aggregateContributionsByPerson,
  getContributionsForYear,
  createCarryForwardOffBalanceSheetItems,
  initializeCarryForwardStates,
  type CarryForwardState,
} from './superContributions';
import type { Event, Person } from '../schemas';

describe('getCapsForYear', () => {
  it('returns exact year caps when available', () => {
    const caps = getCapsForYear(2025);
    expect(caps.concessional).toBe(30000);
    expect(caps.nonConcessional).toBe(120000);
  });

  it('falls back to most recent known year for future years', () => {
    const caps = getCapsForYear(2030);
    expect(caps.concessional).toBe(30000);
  });

  it('returns 2024 caps for 2024', () => {
    const caps = getCapsForYear(2024);
    expect(caps.concessional).toBe(27500);
    expect(caps.nonConcessional).toBe(110000);
  });
});

describe('calculateAvailableCarryForward', () => {
  it('returns 0 for empty carry-forward state', () => {
    const state: CarryForwardState = { personId: 'p1', unusedCaps: [] };
    const result = calculateAvailableCarryForward(state, 2025, 5);
    expect(result).toBe(0);
  });

  it('sums all unused caps within window', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [
        { year: 2021, amount: 5000 },
        { year: 2022, amount: 10000 },
        { year: 2023, amount: 15000 },
        { year: 2024, amount: 20000 },
      ],
    };
    const result = calculateAvailableCarryForward(state, 2025, 5);
    expect(result).toBe(50000);
  });

  it('excludes caps outside the carry-forward window', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [
        { year: 2019, amount: 100000 }, // Expired (> 5 years ago)
        { year: 2020, amount: 100000 }, // Expired (exactly at cutoff)
        { year: 2021, amount: 10000 },  // Valid
        { year: 2024, amount: 20000 },  // Valid
      ],
    };
    const result = calculateAvailableCarryForward(state, 2025, 5);
    expect(result).toBe(30000); // Only 2021 + 2024
  });
});

describe('consumeCarryForward', () => {
  it('uses oldest caps first (FIFO)', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [
        { year: 2022, amount: 10000 },
        { year: 2023, amount: 15000 },
        { year: 2024, amount: 20000 },
      ],
    };
    
    const result = consumeCarryForward(state, 12000, 2025, 5);
    
    expect(result.used).toBe(12000);
    expect(result.remaining).toBe(0);
    // Should have used all of 2022 (10000) and 2000 from 2023
    expect(result.newState.unusedCaps).toEqual([
      { year: 2023, amount: 13000 },
      { year: 2024, amount: 20000 },
    ]);
  });

  it('handles using all carry-forward', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [
        { year: 2023, amount: 10000 },
        { year: 2024, amount: 5000 },
      ],
    };
    
    const result = consumeCarryForward(state, 20000, 2025, 5);
    
    expect(result.used).toBe(15000);
    expect(result.remaining).toBe(5000);
    expect(result.newState.unusedCaps).toEqual([]);
  });

  it('excludes expired caps', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [
        { year: 2019, amount: 100000 }, // Expired
        { year: 2024, amount: 10000 },  // Valid
      ],
    };
    
    const result = consumeCarryForward(state, 5000, 2025, 5);
    
    expect(result.used).toBe(5000);
    expect(result.newState.unusedCaps).toEqual([
      { year: 2024, amount: 5000 },
    ]);
  });

  it('returns original state when no amount needed', () => {
    const state: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [{ year: 2024, amount: 10000 }],
    };
    
    const result = consumeCarryForward(state, 0, 2025, 5);
    
    expect(result.used).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.newState.unusedCaps).toEqual([{ year: 2024, amount: 10000 }]);
  });
});

describe('processPersonContributions', () => {
  const emptyState: CarryForwardState = { personId: 'p1', unusedCaps: [] };

  it('calculates contributions tax at 15%', () => {
    const result = processPersonContributions('p1', 2025, 20000, 0, emptyState);
    
    expect(result.contributionsTax).toBe(3000); // 20000 * 0.15
    expect(result.excessConcessional).toBe(0);
  });

  it('identifies excess when contributions exceed cap', () => {
    const result = processPersonContributions('p1', 2025, 40000, 0, emptyState);
    
    expect(result.excessConcessional).toBe(10000); // 40000 - 30000 cap
    expect(result.contributionsTax).toBe(4500); // 30000 * 0.15
  });

  it('uses carry-forward to cover excess', () => {
    const stateWithCarryForward: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [{ year: 2024, amount: 15000 }],
    };
    
    const result = processPersonContributions('p1', 2025, 40000, 0, stateWithCarryForward);
    
    // Cap is 30000 + 15000 carry forward = 45000
    expect(result.totalAvailableCap).toBe(45000);
    expect(result.excessConcessional).toBe(0);
    expect(result.usedCarryForward).toBe(10000); // Used 10000 of the 15000
    expect(result.remainingCarryForward).toBe(5000);
    expect(result.contributionsTax).toBe(6000); // 40000 * 0.15
  });

  it('adds unused cap to carry-forward', () => {
    const result = processPersonContributions('p1', 2025, 10000, 0, emptyState);
    
    // Unused: 30000 - 10000 = 20000
    expect(result.newCarryForwardState.unusedCaps).toContainEqual({
      year: 2025,
      amount: 20000,
    });
  });

  it('handles zero contributions', () => {
    const result = processPersonContributions('p1', 2025, 0, 0, emptyState);
    
    expect(result.contributionsTax).toBe(0);
    expect(result.excessConcessional).toBe(0);
    expect(result.newCarryForwardState.unusedCaps).toContainEqual({
      year: 2025,
      amount: 30000,
    });
  });

  it('handles exactly at cap', () => {
    const result = processPersonContributions('p1', 2025, 30000, 0, emptyState);
    
    expect(result.excessConcessional).toBe(0);
    expect(result.contributionsTax).toBe(4500);
    expect(result.newCarryForwardState.unusedCaps).toHaveLength(0);
  });

  it('handles non-concessional contributions separately', () => {
    const result = processPersonContributions('p1', 2025, 20000, 50000, emptyState);
    
    expect(result.concessionalContributions).toBe(20000);
    expect(result.nonConcessionalContributions).toBe(50000);
    // Non-concessional doesn't affect concessional tax
    expect(result.contributionsTax).toBe(3000);
  });
});

describe('getContributionsForYear', () => {
  const makeContributionEvent = (
    year: number,
    amount: number,
    type: 'concessional' | 'nonConcessional',
    personId: string
  ): Event => ({
    id: `event-${Math.random()}`,
    year,
    type: 'superContribution',
    description: 'Super contribution',
    amount,
    superContribution: {
      contributionType: type,
      source: 'employerSG',
      memberPersonId: personId,
      reducesAssessableIncome: type === 'concessional',
    },
  });

  it('filters events by year and type', () => {
    const events: Event[] = [
      makeContributionEvent(2025, 10000, 'concessional', 'p1'),
      makeContributionEvent(2025, 5000, 'nonConcessional', 'p1'),
      makeContributionEvent(2024, 8000, 'concessional', 'p1'), // Different year
      {
        id: 'other-event',
        year: 2025,
        type: 'income',
        description: 'Salary',
        amount: 100000,
      },
    ];

    const result = getContributionsForYear(events, 2025);

    expect(result).toHaveLength(2);
    expect(result[0].amount).toBe(10000);
    expect(result[1].amount).toBe(5000);
  });

  it('returns empty array when no matching events', () => {
    const events: Event[] = [];
    const result = getContributionsForYear(events, 2025);
    expect(result).toEqual([]);
  });
});

describe('aggregateContributionsByPerson', () => {
  const persons: Person[] = [
    { id: 'p1', name: 'Person 1', birthYear: 1980 },
    { id: 'p2', name: 'Person 2', birthYear: 1985 },
  ];

  it('aggregates multiple contributions per person', () => {
    const events: Event[] = [
      {
        id: 'e1',
        year: 2025,
        type: 'superContribution',
        description: 'Employer SG',
        amount: 15000,
        superContribution: {
          contributionType: 'concessional',
          source: 'employerSG',
          memberPersonId: 'p1',
          reducesAssessableIncome: false,
        },
      },
      {
        id: 'e2',
        year: 2025,
        type: 'superContribution',
        description: 'Salary Sacrifice',
        amount: 10000,
        superContribution: {
          contributionType: 'concessional',
          source: 'salarySacrifice',
          memberPersonId: 'p1',
          reducesAssessableIncome: true,
        },
      },
      {
        id: 'e3',
        year: 2025,
        type: 'superContribution',
        description: 'Personal',
        amount: 20000,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personalAfterTax',
          memberPersonId: 'p1',
          reducesAssessableIncome: false,
        },
      },
    ];

    const result = aggregateContributionsByPerson(events, 2025, persons);

    expect(result.get('p1')).toEqual({
      concessional: 25000,
      nonConcessional: 20000,
      incomeReduction: 10000, // Only salary sacrifice
    });
    expect(result.get('p2')).toEqual({
      concessional: 0,
      nonConcessional: 0,
      incomeReduction: 0,
    });
  });
});

describe('createCarryForwardOffBalanceSheetItems', () => {
  const persons: Person[] = [
    { id: 'p1', name: 'Alice', birthYear: 1980 },
    { id: 'p2', name: 'Bob', birthYear: 1985 },
  ];

  it('creates items for persons with carry-forward', () => {
    const states = new Map<string, CarryForwardState>([
      ['p1', { personId: 'p1', unusedCaps: [{ year: 2024, amount: 15000 }] }],
      ['p2', { personId: 'p2', unusedCaps: [] }],
    ]);

    const items = createCarryForwardOffBalanceSheetItems(states, persons, 2025);

    expect(items).toHaveLength(1);
    expect(items[0].personId).toBe('p1');
    expect(items[0].value).toBe(15000);
    expect(items[0].label).toContain('Alice');
    expect(items[0].type).toBe('carryForwardContribution');
  });

  it('excludes expired carry-forward', () => {
    const states = new Map<string, CarryForwardState>([
      ['p1', { personId: 'p1', unusedCaps: [{ year: 2019, amount: 50000 }] }],
    ]);

    const items = createCarryForwardOffBalanceSheetItems(states, persons, 2025);

    expect(items).toHaveLength(0);
  });
});

describe('initializeCarryForwardStates', () => {
  it('creates empty state for each person', () => {
    const persons: Person[] = [
      { id: 'p1', name: 'Person 1', birthYear: 1980 },
      { id: 'p2', name: 'Person 2', birthYear: 1985 },
    ];

    const states = initializeCarryForwardStates(persons);

    expect(states.size).toBe(2);
    expect(states.get('p1')).toEqual({ personId: 'p1', unusedCaps: [] });
    expect(states.get('p2')).toEqual({ personId: 'p2', unusedCaps: [] });
  });
});

describe('integration: multi-year carry-forward', () => {
  it('tracks carry-forward across multiple years correctly', () => {
    const personId = 'p1';
    
    // Year 1: Contribute nothing, build up carry-forward
    let state: CarryForwardState = { personId, unusedCaps: [] };
    let result = processPersonContributions(personId, 2022, 0, 0, state);
    state = result.newCarryForwardState;
    expect(state.unusedCaps).toContainEqual({ year: 2022, amount: 27500 });
    
    // Year 2: Contribute nothing again
    result = processPersonContributions(personId, 2023, 0, 0, state);
    state = result.newCarryForwardState;
    expect(state.unusedCaps).toHaveLength(2);
    
    // Year 3: Contribute nothing again
    result = processPersonContributions(personId, 2024, 0, 0, state);
    state = result.newCarryForwardState;
    expect(state.unusedCaps).toHaveLength(3);
    
    // Year 4: Use carry-forward with a large contribution
    result = processPersonContributions(personId, 2025, 100000, 0, state);
    
    // Total available: 30000 (2025) + 27500 (2022) + 27500 (2023) + 27500 (2024) = 112500
    expect(result.totalAvailableCap).toBe(112500);
    expect(result.excessConcessional).toBe(0);
    expect(result.contributionsTax).toBe(15000); // 100000 * 0.15
    
    // Remaining: 112500 - 100000 = 12500
    expect(result.remainingCarryForward).toBe(12500);
  });

  it('expires old carry-forward after 5 years', () => {
    const personId = 'p1';
    
    // Start with old carry-forward from 2019
    const state: CarryForwardState = {
      personId,
      unusedCaps: [
        { year: 2019, amount: 25000 }, // Will be expired in 2025
        { year: 2020, amount: 25000 }, // Will be expired in 2025
        { year: 2021, amount: 25000 }, // Valid
        { year: 2022, amount: 25000 }, // Valid
      ],
    };
    
    // In 2025, with 5-year carry-forward, only 2021+ is valid
    const result = processPersonContributions(personId, 2025, 60000, 0, state);
    
    // Available: 30000 (2025) + 25000 (2021) + 25000 (2022) = 80000
    expect(result.availableCarryForward).toBe(50000);
    expect(result.totalAvailableCap).toBe(80000);
    expect(result.excessConcessional).toBe(0);
  });
});
