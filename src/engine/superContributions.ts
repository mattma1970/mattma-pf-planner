import type { Event, Person, OffBalanceSheetItem } from '../schemas';
import type { SuperSettings } from '../schemas/settings';
import { defaultSuperSettings } from '../schemas/settings';

// Carry-forward tracking per person
export interface CarryForwardState {
  personId: string;
  // Array of unused cap amounts from previous years (oldest first)
  // Each entry is { year, amount }
  unusedCaps: { year: number; amount: number }[];
}

// Result of processing contributions for a year
export interface ContributionProcessingResult {
  personId: string;
  year: number;
  
  // Contributions made
  concessionalContributions: number;
  nonConcessionalContributions: number;
  
  // Cap information
  concessionalCap: number;
  availableCarryForward: number;
  totalAvailableCap: number;
  
  // Excess calculations
  excessConcessional: number;
  usedCarryForward: number;
  remainingCarryForward: number;
  
  // Tax implications
  contributionsTax: number; // 15% on concessional (within cap)
  excessContributionsTax: number; // Excess taxed at marginal rate (simplified)
  
  // Updated carry-forward state
  newCarryForwardState: CarryForwardState;
}

/**
 * Extract super contribution events for a specific year
 */
export function getContributionsForYear(
  events: Event[],
  year: number
): { personId: string; amount: number; type: 'concessional' | 'nonConcessional'; reducesIncome: boolean }[] {
  return events
    .filter(e => e.year === year && e.type === 'superContribution' && e.superContribution)
    .map(e => ({
      personId: e.superContribution!.memberPersonId,
      amount: e.amount,
      type: e.superContribution!.contributionType,
      reducesIncome: e.superContribution!.reducesAssessableIncome ?? false,
    }));
}

/**
 * Aggregate contributions by person for a year
 */
export function aggregateContributionsByPerson(
  events: Event[],
  year: number,
  persons: Person[]
): Map<string, { concessional: number; nonConcessional: number; incomeReduction: number }> {
  const contributions = getContributionsForYear(events, year);
  const byPerson = new Map<string, { concessional: number; nonConcessional: number; incomeReduction: number }>();
  
  // Initialize for all persons
  for (const person of persons) {
    byPerson.set(person.id, { concessional: 0, nonConcessional: 0, incomeReduction: 0 });
  }
  
  // Sum contributions
  for (const contrib of contributions) {
    const current = byPerson.get(contrib.personId);
    if (current) {
      if (contrib.type === 'concessional') {
        current.concessional += contrib.amount;
        if (contrib.reducesIncome) {
          current.incomeReduction += contrib.amount;
        }
      } else {
        current.nonConcessional += contrib.amount;
      }
    }
  }
  
  return byPerson;
}

/**
 * Calculate available carry-forward for a person
 */
export function calculateAvailableCarryForward(
  state: CarryForwardState,
  currentYear: number,
  carryForwardYears: number
): number {
  // Only include caps from within the carry-forward window
  const cutoffYear = currentYear - carryForwardYears;
  
  return state.unusedCaps
    .filter(cap => cap.year > cutoffYear)
    .reduce((sum, cap) => sum + cap.amount, 0);
}

/**
 * Use carry-forward to cover excess contributions (FIFO - oldest first)
 */
export function consumeCarryForward(
  state: CarryForwardState,
  amountNeeded: number,
  currentYear: number,
  carryForwardYears: number
): { used: number; remaining: number; newState: CarryForwardState } {
  const cutoffYear = currentYear - carryForwardYears;
  let remaining = amountNeeded;
  let used = 0;
  
  const newUnusedCaps: { year: number; amount: number }[] = [];
  
  for (const cap of state.unusedCaps) {
    // Skip expired caps
    if (cap.year <= cutoffYear) {
      continue;
    }
    
    if (remaining > 0) {
      const useFromThisCap = Math.min(cap.amount, remaining);
      used += useFromThisCap;
      remaining -= useFromThisCap;
      
      // Keep any unused portion
      if (cap.amount > useFromThisCap) {
        newUnusedCaps.push({ year: cap.year, amount: cap.amount - useFromThisCap });
      }
    } else {
      // No more needed, keep this cap
      newUnusedCaps.push(cap);
    }
  }
  
  return {
    used,
    remaining,
    newState: { personId: state.personId, unusedCaps: newUnusedCaps },
  };
}

/**
 * Process contributions for a person for a year
 */
export function processPersonContributions(
  personId: string,
  year: number,
  concessionalContributions: number,
  nonConcessionalContributions: number,
  carryForwardState: CarryForwardState,
  superSettings: SuperSettings = defaultSuperSettings
): ContributionProcessingResult {
  const { concessionalCap, carryForwardYears, contributionsTaxRate } = superSettings;
  
  // Calculate available carry-forward (only for concessional)
  const availableCarryForward = calculateAvailableCarryForward(
    carryForwardState,
    year,
    carryForwardYears
  );
  
  const totalAvailableCap = concessionalCap + availableCarryForward;
  
  // Calculate excess
  const excessConcessional = Math.max(0, concessionalContributions - totalAvailableCap);
  const contributionsWithinCap = Math.min(concessionalContributions, totalAvailableCap);
  
  // Calculate how much carry-forward is needed
  const neededFromCarryForward = Math.max(0, contributionsWithinCap - concessionalCap);
  
  // Use carry-forward (FIFO)
  const carryForwardResult = consumeCarryForward(
    carryForwardState,
    neededFromCarryForward,
    year,
    carryForwardYears
  );
  
  // Calculate unused current year cap to add to carry-forward
  const unusedCurrentYearCap = Math.max(0, concessionalCap - concessionalContributions);
  
  // Build new carry-forward state
  const newCarryForwardState: CarryForwardState = {
    personId,
    unusedCaps: [
      ...carryForwardResult.newState.unusedCaps,
      ...(unusedCurrentYearCap > 0 ? [{ year, amount: unusedCurrentYearCap }] : []),
    ],
  };
  
  // Calculate taxes
  // Contributions tax on concessional within cap
  const contributionsTax = contributionsWithinCap * contributionsTaxRate;
  
  // Excess concessional is included in assessable income and taxed at marginal rates
  // For now, we just flag the excess - the main tax engine will handle marginal rate
  const excessContributionsTax = 0; // Handled by income tax calculation
  
  // Calculate remaining carry-forward
  const remainingCarryForward = newCarryForwardState.unusedCaps
    .filter(cap => cap.year > year - carryForwardYears)
    .reduce((sum, cap) => sum + cap.amount, 0);
  
  return {
    personId,
    year,
    concessionalContributions,
    nonConcessionalContributions,
    concessionalCap,
    availableCarryForward,
    totalAvailableCap,
    excessConcessional,
    usedCarryForward: carryForwardResult.used,
    remainingCarryForward,
    contributionsTax,
    excessContributionsTax,
    newCarryForwardState,
  };
}

/**
 * Create off-balance sheet items for carry-forward balances
 */
export function createCarryForwardOffBalanceSheetItems(
  carryForwardStates: Map<string, CarryForwardState>,
  persons: Person[],
  year: number,
  superSettings: SuperSettings = defaultSuperSettings
): OffBalanceSheetItem[] {
  const { carryForwardYears } = superSettings;
  const items: OffBalanceSheetItem[] = [];
  
  for (const person of persons) {
    const state = carryForwardStates.get(person.id);
    if (!state) continue;
    
    const availableCarryForward = calculateAvailableCarryForward(state, year, carryForwardYears);
    
    if (availableCarryForward > 0) {
      items.push({
        id: `carry-forward-${person.id}-${year}`,
        type: 'carryForwardContribution',
        label: `${person.name} - Concessional Carry Forward`,
        personId: person.id,
        value: availableCarryForward,
      });
    }
  }
  
  return items;
}

/**
 * Initialize carry-forward state for persons
 * In a real scenario, this might be loaded from stored data
 */
export function initializeCarryForwardStates(persons: Person[]): Map<string, CarryForwardState> {
  const states = new Map<string, CarryForwardState>();
  
  for (const person of persons) {
    states.set(person.id, {
      personId: person.id,
      unusedCaps: [],
    });
  }
  
  return states;
}
