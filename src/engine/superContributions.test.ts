import { describe, it, expect } from 'vitest';
import {
  calculateAvailableCarryForward,
  consumeCarryForward,
  processPersonContributions,
  aggregateContributionsByPerson,
  getContributionsForYear,
  createCarryForwardOffBalanceSheetItems,
  initializeCarryForwardStates,
  calculateEffectiveIncomeReduction,
  initializeCarryForwardStatesFromAccounts,
  initializeNonConcessionalCapStatesFromAccounts,
  createTaxAccountYearResults,
  type CarryForwardState,
  type NonConcessionalCapState,
} from './superContributions';
import type { Event, Person, Account } from '../schemas';
import type { SuperSettings } from '../schemas/settings';

// Test super settings
const testSettings: SuperSettings = {
  preservationAge: 67,
  concessionalCap: 30000,
  nonConcessionalCap: 120000,
  carryForwardYears: 5,
  contributionsTaxRate: 0.15,
  div293Threshold: 250000,
  div293Rate: 0.15,
};

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
  const emptyCarryForwardState: CarryForwardState = { personId: 'p1', unusedCaps: [] };
  const emptyNonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };

  it('calculates contributions tax at 15%', () => {
    const result = processPersonContributions('p1', 2025, 20000, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.contributionsTax).toBe(3000); // 20000 * 0.15
    expect(result.excessConcessional).toBe(0);
  });

  it('identifies excess when contributions exceed cap', () => {
    const result = processPersonContributions('p1', 2025, 40000, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.excessConcessional).toBe(10000); // 40000 - 30000 cap
    expect(result.contributionsTax).toBe(4500); // 30000 * 0.15
  });

  it('excess concessional flows to non-concessional cap', () => {
    // Contribute $50k concessional (exceeds $30k cap by $20k)
    // The $20k excess becomes effectively non-concessional
    const result = processPersonContributions('p1', 2025, 50000, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.excessConcessional).toBe(20000); // 50000 - 30000 cap
    
    // Non-concessional cap should be reduced by the $20k excess
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.nonConcessionalCapMovement).toBe(-20000); // Excess concessional counts here
    expect(result.nonConcessionalCapClosing).toBe(100000);
  });

  it('excess concessional combines with explicit non-concessional for cap', () => {
    // $40k concessional (exceeds $30k cap by $10k) + $50k explicit non-concessional
    // Total non-concessional for cap = $10k + $50k = $60k
    const result = processPersonContributions('p1', 2025, 40000, 50000, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.excessConcessional).toBe(10000);
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.nonConcessionalCapMovement).toBe(-60000); // $50k explicit + $10k excess
    expect(result.nonConcessionalCapClosing).toBe(60000);
  });

  it('uses carry-forward to cover excess', () => {
    const stateWithCarryForward: CarryForwardState = {
      personId: 'p1',
      unusedCaps: [{ year: 2024, amount: 15000 }],
    };
    
    const result = processPersonContributions('p1', 2025, 40000, 0, stateWithCarryForward, emptyNonConcState, testSettings);
    
    // Cap is 30000 + 15000 carry forward = 45000
    expect(result.totalAvailableCap).toBe(45000);
    expect(result.excessConcessional).toBe(0);
    expect(result.usedCarryForward).toBe(10000); // Used 10000 of the 15000
    expect(result.remainingCarryForward).toBe(5000);
    expect(result.contributionsTax).toBe(6000); // 40000 * 0.15
  });

  it('adds unused cap to carry-forward', () => {
    const result = processPersonContributions('p1', 2025, 10000, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    // Unused: 30000 - 10000 = 20000
    expect(result.newCarryForwardState.unusedCaps).toContainEqual({
      year: 2025,
      amount: 20000,
    });
  });

  it('handles zero contributions', () => {
    const result = processPersonContributions('p1', 2025, 0, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.contributionsTax).toBe(0);
    expect(result.excessConcessional).toBe(0);
    expect(result.newCarryForwardState.unusedCaps).toContainEqual({
      year: 2025,
      amount: 30000,
    });
  });

  it('handles exactly at cap', () => {
    const result = processPersonContributions('p1', 2025, 30000, 0, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.excessConcessional).toBe(0);
    expect(result.contributionsTax).toBe(4500);
    expect(result.newCarryForwardState.unusedCaps).toHaveLength(0);
  });

  it('handles non-concessional contributions separately', () => {
    const result = processPersonContributions('p1', 2025, 20000, 50000, emptyCarryForwardState, emptyNonConcState, testSettings);
    
    expect(result.concessionalContributions).toBe(20000);
    expect(result.nonConcessionalContributions).toBe(50000);
    // Non-concessional doesn't affect concessional tax
    expect(result.contributionsTax).toBe(3000);
  });

  it('uses custom tax rate from settings', () => {
    const customSettings: SuperSettings = {
      ...testSettings,
      contributionsTaxRate: 0.20, // 20% instead of 15%
    };
    
    const result = processPersonContributions('p1', 2025, 20000, 0, emptyCarryForwardState, emptyNonConcState, customSettings);
    
    expect(result.contributionsTax).toBe(4000); // 20000 * 0.20
  });

  it('uses custom cap from settings', () => {
    const customSettings: SuperSettings = {
      ...testSettings,
      concessionalCap: 50000, // Higher cap
    };
    
    const result = processPersonContributions('p1', 2025, 40000, 0, emptyCarryForwardState, emptyNonConcState, customSettings);
    
    expect(result.excessConcessional).toBe(0); // No excess with 50k cap
    expect(result.concessionalCap).toBe(50000);
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
      exemptFromCap: false,
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

    const result = getContributionsForYear(events, 2025, []);

    expect(result).toHaveLength(2);
    expect(result[0].amount).toBe(10000);
    expect(result[1].amount).toBe(5000);
  });

  it('returns empty array when no matching events', () => {
    const events: Event[] = [];
    const result = getContributionsForYear(events, 2025, []);
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
          exemptFromCap: false,
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
          exemptFromCap: false,
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
          source: 'personal',
          memberPersonId: 'p1',
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      },
    ];

    const result = aggregateContributionsByPerson(events, 2025, persons, []);

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

    const items = createCarryForwardOffBalanceSheetItems(states, persons, 2025, testSettings);

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

    const items = createCarryForwardOffBalanceSheetItems(states, persons, 2025, testSettings);

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
  const emptyNonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
  
  it('tracks carry-forward across multiple years correctly', () => {
    const personId = 'p1';
    
    // Year 1: Contribute nothing, build up carry-forward
    let state: CarryForwardState = { personId, unusedCaps: [] };
    let nonConcState: NonConcessionalCapState = { personId, closingBalance: 0 };
    let result = processPersonContributions(personId, 2022, 0, 0, state, nonConcState, testSettings);
    state = result.newCarryForwardState;
    nonConcState = result.newNonConcessionalCapState;
    expect(state.unusedCaps).toContainEqual({ year: 2022, amount: 30000 });
    
    // Year 2: Contribute nothing again
    result = processPersonContributions(personId, 2023, 0, 0, state, nonConcState, testSettings);
    state = result.newCarryForwardState;
    nonConcState = result.newNonConcessionalCapState;
    expect(state.unusedCaps).toHaveLength(2);
    
    // Year 3: Contribute nothing again
    result = processPersonContributions(personId, 2024, 0, 0, state, nonConcState, testSettings);
    state = result.newCarryForwardState;
    nonConcState = result.newNonConcessionalCapState;
    expect(state.unusedCaps).toHaveLength(3);
    
    // Year 4: Use carry-forward with a large contribution
    result = processPersonContributions(personId, 2025, 100000, 0, state, nonConcState, testSettings);
    
    // Total available: 30000 (2025) + 30000 (2022) + 30000 (2023) + 30000 (2024) = 120000
    expect(result.totalAvailableCap).toBe(120000);
    expect(result.excessConcessional).toBe(0);
    expect(result.contributionsTax).toBe(15000); // 100000 * 0.15
    
    // Remaining: 120000 - 100000 = 20000
    expect(result.remainingCarryForward).toBe(20000);
  });

  it('expires old carry-forward after configured years', () => {
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
    const result = processPersonContributions(personId, 2025, 60000, 0, state, emptyNonConcState, testSettings);
    
    // Available: 30000 (2025) + 25000 (2021) + 25000 (2022) = 80000
    expect(result.availableCarryForward).toBe(50000);
    expect(result.totalAvailableCap).toBe(80000);
    expect(result.excessConcessional).toBe(0);
  });
});

describe('non-concessional cap with bring-forward', () => {
  const emptyCarryForwardState: CarryForwardState = { personId: 'p1', unusedCaps: [] };
  
  it('initializes with full annual cap when prior closing >= 0', () => {
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
    const result = processPersonContributions('p1', 2025, 0, 50000, emptyCarryForwardState, nonConcState, testSettings);
    
    // Opening should be $120k (annual cap)
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.nonConcessionalCapMovement).toBe(-50000);
    expect(result.nonConcessionalCapClosing).toBe(70000);
    expect(result.blockedNonConcessional).toBe(0);
    expect(result.excessNonConcessional).toBe(0);
  });

  it('triggers bring-forward when contribution exceeds annual cap', () => {
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
    const result = processPersonContributions('p1', 2025, 0, 360000, emptyCarryForwardState, nonConcState, testSettings);
    
    // Contribute full $360k using bring-forward
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.nonConcessionalCapMovement).toBe(-360000);
    expect(result.nonConcessionalCapClosing).toBe(-240000); // At the limit
    expect(result.blockedNonConcessional).toBe(0);
    expect(result.excessNonConcessional).toBe(0);
  });

  it('adds annual cap to prior closing when recovering from bring-forward', () => {
    // Prior year closed at -$240k (used full bring-forward)
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: -240000 };
    const result = processPersonContributions('p1', 2026, 0, 0, emptyCarryForwardState, nonConcState, testSettings);
    
    // Opening: -$240k + $120k = -$120k
    expect(result.nonConcessionalCapOpening).toBe(-120000);
    // Since opening <= 0, contributions are blocked
  });

  it('blocks contributions when opening <= 0', () => {
    // Prior year closed at -$120k (recovering from bring-forward)
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: -120000 };
    const result = processPersonContributions('p1', 2026, 0, 50000, emptyCarryForwardState, nonConcState, testSettings);
    
    // Opening: -$120k + $120k = $0
    expect(result.nonConcessionalCapOpening).toBe(0);
    // Opening <= 0, so contributions are blocked
    expect(result.blockedNonConcessional).toBe(50000);
    expect(result.nonConcessionalContributions).toBe(0); // No cap-relevant contributions processed
    expect(result.nonConcessionalCapClosing).toBe(0);
  });

  it('flags excess when closing would go below -$240k', () => {
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
    const result = processPersonContributions('p1', 2025, 0, 400000, emptyCarryForwardState, nonConcState, testSettings);
    
    // Trying to contribute $400k but max is $360k (3-year limit)
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.excessNonConcessional).toBe(40000); // $400k - $360k
    expect(result.nonConcessionalCapClosing).toBe(-240000); // Capped at minimum
  });

  it('resets cap after bring-forward is fully recovered', () => {
    // Simulate multi-year recovery
    const personId = 'p1';
    
    // Year 1: Use full $360k bring-forward
    let nonConcState: NonConcessionalCapState = { personId, closingBalance: 0 };
    let result = processPersonContributions(personId, 2025, 0, 360000, emptyCarryForwardState, nonConcState, testSettings);
    expect(result.nonConcessionalCapClosing).toBe(-240000);
    nonConcState = result.newNonConcessionalCapState;
    
    // Year 2: Opening = -$120k, blocked
    result = processPersonContributions(personId, 2026, 0, 0, emptyCarryForwardState, nonConcState, testSettings);
    expect(result.nonConcessionalCapOpening).toBe(-120000);
    expect(result.nonConcessionalCapClosing).toBe(-120000);
    nonConcState = result.newNonConcessionalCapState;
    
    // Year 3: Opening = $0, still blocked
    result = processPersonContributions(personId, 2027, 0, 0, emptyCarryForwardState, nonConcState, testSettings);
    expect(result.nonConcessionalCapOpening).toBe(0);
    expect(result.nonConcessionalCapClosing).toBe(0);
    nonConcState = result.newNonConcessionalCapState;
    
    // Year 4: Reset! Opening = $120k
    result = processPersonContributions(personId, 2028, 0, 50000, emptyCarryForwardState, nonConcState, testSettings);
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.blockedNonConcessional).toBe(0);
    expect(result.nonConcessionalCapClosing).toBe(70000);
  });

  it('tracks non-concessional cap in off-balance sheet items', () => {
    const nonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
    const result = processPersonContributions('p1', 2025, 0, 100000, emptyCarryForwardState, nonConcState, testSettings);
    
    expect(result.nonConcessionalCapOpening).toBe(120000);
    expect(result.nonConcessionalCapMovement).toBe(-100000);
    expect(result.nonConcessionalCapClosing).toBe(20000);
    expect(result.newNonConcessionalCapState.closingBalance).toBe(20000);
  });
});

describe('exemptFromCap contributions', () => {
  const persons: Person[] = [{ id: 'p1', name: 'Alice', birthYear: 1980 }];
  
  it('excludes exempt contributions from cap tracking', () => {
    const events: Event[] = [
      {
        id: 'e1',
        year: 2025,
        type: 'superContribution',
        description: 'Downsizer contribution',
        amount: 300000,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'downsizer',
          memberPersonId: 'p1',
          reducesAssessableIncome: false,
          exemptFromCap: true,
        },
      },
      {
        id: 'e2',
        year: 2025,
        type: 'superContribution',
        description: 'Personal after-tax',
        amount: 50000,
        superContribution: {
          contributionType: 'nonConcessional',
          source: 'personal',
          memberPersonId: 'p1',
          reducesAssessableIncome: false,
          exemptFromCap: false,
        },
      },
    ];
    
    const result = aggregateContributionsByPerson(events, 2025, persons, []);
    
    // Only the $50k non-exempt should be counted
    expect(result.get('p1')?.nonConcessional).toBe(50000);
  });

  it('includes exempt contributions in income reduction tracking', () => {
    const events: Event[] = [
      {
        id: 'e1',
        year: 2025,
        type: 'superContribution',
        description: 'Personal deductible',
        amount: 20000,
        superContribution: {
          contributionType: 'concessional',
          source: 'personal',
          memberPersonId: 'p1',
          reducesAssessableIncome: true,
          exemptFromCap: true, // Hypothetical exempt concessional
        },
      },
    ];
    
    const result = aggregateContributionsByPerson(events, 2025, persons, []);
    
    // Income reduction is tracked even for exempt
    expect(result.get('p1')?.incomeReduction).toBe(20000);
    // But cap tracking excludes it
    expect(result.get('p1')?.concessional).toBe(0);
  });
});

describe('calculateEffectiveIncomeReduction', () => {
  it('allows full deduction when within cap', () => {
    const result = calculateEffectiveIncomeReduction(20000, 20000, 30000);
    
    expect(result.effectiveReduction).toBe(20000);
    expect(result.excessNotDeductible).toBe(0);
  });

  it('limits deduction to available cap when claimed exceeds cap', () => {
    // Claimed $50k deduction, made $50k concessional, but only $30k cap available
    const result = calculateEffectiveIncomeReduction(50000, 50000, 30000);
    
    expect(result.effectiveReduction).toBe(30000);
    expect(result.excessNotDeductible).toBe(20000);
  });

  it('limits deduction to concessional contribution when claimed exceeds contribution', () => {
    // Claimed $30k deduction but only contributed $20k concessional
    const result = calculateEffectiveIncomeReduction(30000, 20000, 30000);
    
    expect(result.effectiveReduction).toBe(20000);
    expect(result.excessNotDeductible).toBe(10000);
  });

  it('handles zero claimed reduction', () => {
    const result = calculateEffectiveIncomeReduction(0, 50000, 30000);
    
    expect(result.effectiveReduction).toBe(0);
    expect(result.excessNotDeductible).toBe(0);
  });

  it('handles case where cap is limiting factor with carry-forward', () => {
    // Cap of $60k (includes carry-forward), contributed $80k, claimed $80k deduction
    const result = calculateEffectiveIncomeReduction(80000, 80000, 60000);
    
    expect(result.effectiveReduction).toBe(60000);
    expect(result.excessNotDeductible).toBe(20000);
  });
});

describe('initializeCarryForwardStatesFromAccounts', () => {
  const persons: Person[] = [
    { id: 'p1', name: 'Alice', birthYear: 1980 },
    { id: 'p2', name: 'Bob', birthYear: 1975 },
  ];

  it('returns empty unusedCaps for all persons when no tax accounts exist', () => {
    const accounts: Account[] = [];
    const result = initializeCarryForwardStatesFromAccounts(persons, accounts, 2025, testSettings);
    
    expect(result.get('p1')?.unusedCaps).toEqual([]);
    expect(result.get('p2')?.unusedCaps).toEqual([]);
  });

  it('uses explicit buckets from specialConfig when present', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        name: 'Alice Carry Forward',
        type: 'asset',
        category: 'taxCarryForward',
        includeInNetWorth: false,
        owner: 'p1',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'concessionalCarryForward',
          buckets: [
            { year: 2022, amount: 10000 },
            { year: 2023, amount: 15000 },
          ],
        },
      },
    ];
    
    const result = initializeCarryForwardStatesFromAccounts(persons, accounts, 2025, testSettings);
    
    expect(result.get('p1')?.unusedCaps).toEqual([
      { year: 2022, amount: 10000 },
      { year: 2023, amount: 15000 },
    ]);
    expect(result.get('p2')?.unusedCaps).toEqual([]);
  });

  it('creates synthetic bucket at oldest valid year when only initialValue > 0', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        name: 'Bob Carry Forward',
        type: 'asset',
        category: 'taxCarryForward',
        includeInNetWorth: false,
        owner: 'p2',
        initialValue: 25000,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'concessionalCarryForward',
          buckets: [],
        },
      },
    ];
    
    const result = initializeCarryForwardStatesFromAccounts(persons, accounts, 2025, testSettings);
    
    expect(result.get('p2')?.unusedCaps).toEqual([
      { year: 2020, amount: 25000 },
    ]);
  });
});

describe('initializeNonConcessionalCapStatesFromAccounts', () => {
  const persons: Person[] = [
    { id: 'p1', name: 'Alice', birthYear: 1980 },
    { id: 'p2', name: 'Bob', birthYear: 1975 },
  ];

  it('returns closingBalance = 0 when no tax accounts exist', () => {
    const accounts: Account[] = [];
    const result = initializeNonConcessionalCapStatesFromAccounts(persons, accounts);
    
    expect(result.get('p1')?.closingBalance).toBe(0);
    expect(result.get('p2')?.closingBalance).toBe(0);
  });

  it('uses priorClosingBalance from specialConfig when present', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        name: 'Alice Non-Concessional Cap',
        type: 'asset',
        category: 'taxCap',
        includeInNetWorth: false,
        owner: 'p1',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'nonConcessionalCap',
          priorClosingBalance: -120000,
        },
      },
    ];
    
    const result = initializeNonConcessionalCapStatesFromAccounts(persons, accounts);
    
    expect(result.get('p1')?.closingBalance).toBe(-120000);
    expect(result.get('p2')?.closingBalance).toBe(0);
  });

  it('uses initialValue as closingBalance when priorClosingBalance is not set', () => {
    const accounts: Account[] = [
      {
        id: 'acc-1',
        name: 'Bob Non-Concessional Cap',
        type: 'asset',
        category: 'taxCap',
        includeInNetWorth: false,
        owner: 'p2',
        initialValue: 60000,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'nonConcessionalCap',
          priorClosingBalance: undefined,
        } as any,
      },
    ];
    
    const result = initializeNonConcessionalCapStatesFromAccounts(persons, accounts);
    
    expect(result.get('p2')?.closingBalance).toBe(60000);
  });
});

describe('createTaxAccountYearResults', () => {
  it('creates AccountYearResult with correct opening/closing values for cap accounts', () => {
    const accounts: Account[] = [
      {
        id: 'conc-acc-1',
        name: 'Alice Concessional Carry Forward',
        type: 'asset',
        category: 'taxCarryForward',
        includeInNetWorth: false,
        owner: 'p1',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'concessionalCarryForward',
          buckets: [],
        },
      },
      {
        id: 'nonconc-acc-1',
        name: 'Alice Non-Concessional Cap',
        type: 'asset',
        category: 'taxCap',
        includeInNetWorth: false,
        owner: 'p1',
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
        specialConfig: {
          kind: 'nonConcessionalCap',
          priorClosingBalance: 0,
        },
      },
    ];
    
    const emptyCarryForwardState: CarryForwardState = { personId: 'p1', unusedCaps: [] };
    const emptyNonConcState: NonConcessionalCapState = { personId: 'p1', closingBalance: 0 };
    const contributionResult = processPersonContributions(
      'p1', 2025, 20000, 50000, emptyCarryForwardState, emptyNonConcState, testSettings
    );
    
    const yearResults = createTaxAccountYearResults([contributionResult], accounts, 2025);
    
    expect(yearResults).toHaveLength(2);
    
    const concResult = yearResults.find(r => r.accountId === 'conc-acc-1');
    expect(concResult).toBeDefined();
    expect(concResult?.startValue).toBe(30000);
    expect(concResult?.withdrawals).toBe(20000);
    expect(concResult?.endValue).toBe(10000);
    
    const nonConcResult = yearResults.find(r => r.accountId === 'nonconc-acc-1');
    expect(nonConcResult).toBeDefined();
    expect(nonConcResult?.startValue).toBe(120000);
    expect(nonConcResult?.withdrawals).toBe(50000);
    expect(nonConcResult?.endValue).toBe(70000);
  });
});
