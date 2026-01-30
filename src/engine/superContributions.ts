import type { Account, Event, Person, OffBalanceSheetItem, SuperContributionType } from '../schemas';
import type { SuperSettings } from '../schemas/settings';
import { defaultSuperSettings } from '../schemas/settings';

/**
 * Check if a contribution type is cap-exempt
 */
export function isCapExempt(type: SuperContributionType): boolean {
  return type === 'capExempt';
}

/**
 * Map contribution type to tax category (concessional vs non-concessional)
 * Cap-exempt contributions are treated as non-concessional for money flow (no 15% contributions tax)
 */
export function getContributionTaxCategory(type: SuperContributionType): 'concessional' | 'nonConcessional' {
  if (type === 'concessional') return 'concessional';
  return 'nonConcessional'; // nonConcessional and capExempt
}

// Carry-forward tracking per person (concessional)
export interface CarryForwardState {
  personId: string;
  // Array of unused cap amounts from previous years (oldest first)
  // Each entry is { year, amount }
  unusedCaps: { year: number; amount: number }[];
}

// Non-concessional cap state per person (bring-forward tracking)
export interface NonConcessionalCapState {
  personId: string;
  // Closing cap balance at end of the last processed year (may be negative)
  closingBalance: number;
}

// Result of processing contributions for a year
export interface ContributionProcessingResult {
  personId: string;
  year: number;
  
  // Contributions made (cap-relevant only, excluding exemptFromCap)
  concessionalContributions: number;
  nonConcessionalContributions: number;
  
  // Concessional cap information
  concessionalCap: number;
  availableCarryForward: number;
  totalAvailableCap: number;
  
  // Concessional excess calculations
  excessConcessional: number;
  usedCarryForward: number;
  remainingCarryForward: number;
  
  // Non-concessional cap account (bring-forward)
  nonConcessionalCapOpening: number;
  nonConcessionalCapMovement: number;
  nonConcessionalCapClosing: number;
  blockedNonConcessional: number; // Contributions blocked because opening <= 0
  excessNonConcessional: number; // Contributions exceeding 3-year limit (closing < -240k)
  
  // Tax implications
  contributionsTax: number; // 15% on concessional (within cap)
  excessContributionsTax: number; // Excess taxed at marginal rate (simplified)
  
  // Updated states
  newCarryForwardState: CarryForwardState;
  newNonConcessionalCapState: NonConcessionalCapState;
}

/**
 * Extract super contribution events for a specific year
 * Person is derived from the target account's owner (or falls back to memberPersonId for backwards compatibility)
 */
export function getContributionsForYear(
  events: Event[],
  year: number,
  accounts: Account[]
): { personId: string; amount: number; type: 'concessional' | 'nonConcessional'; reducesIncome: boolean; exemptFromCap: boolean }[] {
  const accountById = new Map(accounts.map(a => [a.id, a]));
  
  return events
    .filter(e => e.year === year && e.type === 'superContribution' && e.superContribution)
    .map(e => {
      const contributionType = e.superContribution!.contributionType;
      // Derive exemptFromCap from contribution type OR explicit flag
      const exemptFromCap = e.superContribution!.exemptFromCap ?? isCapExempt(contributionType);
      
      // Derive person from target account's owner, fallback to memberPersonId for backwards compatibility
      const targetAccount = e.targetAccountId ? accountById.get(e.targetAccountId) : undefined;
      const personId = targetAccount?.owner || e.superContribution!.memberPersonId;
      
      return {
        personId,
        amount: e.amount,
        type: getContributionTaxCategory(contributionType), // Map to concessional/nonConcessional
        reducesIncome: e.superContribution!.reducesAssessableIncome ?? false,
        exemptFromCap,
      };
    });
}

/**
 * Aggregate contributions by person for a year (cap-relevant only, excludes exemptFromCap)
 */
export function aggregateContributionsByPerson(
  events: Event[],
  year: number,
  persons: Person[],
  accounts: Account[]
): Map<string, { concessional: number; nonConcessional: number; incomeReduction: number }> {
  const contributions = getContributionsForYear(events, year, accounts);
  const byPerson = new Map<string, { concessional: number; nonConcessional: number; incomeReduction: number }>();
  
  // Initialize for all persons
  for (const person of persons) {
    byPerson.set(person.id, { concessional: 0, nonConcessional: 0, incomeReduction: 0 });
  }
  
  // Sum contributions (excluding exemptFromCap for cap calculations)
  for (const contrib of contributions) {
    const current = byPerson.get(contrib.personId);
    if (!current) continue;
    
    // Track income reduction for deductible contributions
    // Note: This is the CLAIMED amount - will be capped later based on concessional limit
    if (contrib.type === 'concessional' && contrib.reducesIncome) {
      current.incomeReduction += contrib.amount;
    }
    
    // Skip exempt contributions for cap tracking
    if (contrib.exemptFromCap) continue;
    
    if (contrib.type === 'concessional') {
      current.concessional += contrib.amount;
    } else {
      current.nonConcessional += contrib.amount;
    }
  }
  
  return byPerson;
}

/**
 * Calculate the effective (capped) income reduction based on concessional limits
 * The deduction is limited to the lesser of: claimed amount, or available concessional cap
 */
export function calculateEffectiveIncomeReduction(
  claimedReduction: number,
  totalConcessional: number,
  availableConcessionalCap: number
): { effectiveReduction: number; excessNotDeductible: number } {
  // The maximum deductible is the lesser of:
  // 1. What was claimed as income-reducing
  // 2. The total concessional contributions
  // 3. The available concessional cap
  const maxDeductible = Math.min(claimedReduction, totalConcessional, availableConcessionalCap);
  
  return {
    effectiveReduction: maxDeductible,
    excessNotDeductible: claimedReduction - maxDeductible,
  };
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
  nonConcessionalCapState: NonConcessionalCapState,
  superSettings: SuperSettings = defaultSuperSettings
): ContributionProcessingResult {
  const { concessionalCap, carryForwardYears, contributionsTaxRate, nonConcessionalCap } = superSettings;
  
  // ===========================================
  // CONCESSIONAL CAP (CARRY-FORWARD) PROCESSING
  // Must be done first to determine excess that flows to non-concessional
  // ===========================================
  
  // Calculate available carry-forward (only for concessional)
  const availableCarryForward = calculateAvailableCarryForward(
    carryForwardState,
    year,
    carryForwardYears
  );
  
  const totalAvailableCap = concessionalCap + availableCarryForward;
  
  // Calculate excess concessional - this will flow to non-concessional cap
  const excessConcessional = Math.max(0, concessionalContributions - totalAvailableCap);
  const contributionsWithinCap = Math.min(concessionalContributions, totalAvailableCap);
  
  // ===========================================
  // NON-CONCESSIONAL CAP (BRING-FORWARD) PROCESSING
  // Includes excess concessional (effectively becomes after-tax contribution)
  // ===========================================
  const bringForwardYears = 3;
  const maxTotalCap = nonConcessionalCap * bringForwardYears; // e.g. 360k
  const minClosing = nonConcessionalCap - maxTotalCap; // e.g. 120k - 360k = -240k
  
  // Prior closing (from last year)
  const priorClosing = nonConcessionalCapState.closingBalance;
  
  // Rule: opening = $120k if prior closing >= 0, else prior + $120k
  const nonConcessionalCapOpening = priorClosing >= 0 ? nonConcessionalCap : priorClosing + nonConcessionalCap;
  
  // Total non-concessional = explicit non-concessional + excess concessional
  const totalNonConcessionalForCap = nonConcessionalContributions + excessConcessional;
  
  let blockedNonConcessional = 0;
  let excessNonConcessional = 0;
  let capRelevantNonConcessional = totalNonConcessionalForCap;
  let nonConcessionalCapClosing: number;
  
  if (nonConcessionalCapOpening <= 0) {
    // Block contributions when opening <= 0
    blockedNonConcessional = capRelevantNonConcessional;
    capRelevantNonConcessional = 0;
    nonConcessionalCapClosing = nonConcessionalCapOpening;
  } else {
    // Provisional closing
    const provisionalClosing = nonConcessionalCapOpening - capRelevantNonConcessional;
    
    if (provisionalClosing < minClosing) {
      // Excess when closing would go below -$240k (3-year limit)
      nonConcessionalCapClosing = minClosing;
      const maxUsageThisYear = nonConcessionalCapOpening - minClosing;
      const allowedThisYear = Math.max(0, maxUsageThisYear);
      excessNonConcessional = capRelevantNonConcessional - allowedThisYear;
      capRelevantNonConcessional = allowedThisYear;
    } else {
      nonConcessionalCapClosing = provisionalClosing;
    }
  }
  
  const nonConcessionalCapMovement = nonConcessionalCapClosing - nonConcessionalCapOpening;
  
  const newNonConcessionalCapState: NonConcessionalCapState = {
    personId,
    closingBalance: nonConcessionalCapClosing,
  };
  
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
    nonConcessionalContributions: capRelevantNonConcessional,
    concessionalCap,
    availableCarryForward,
    totalAvailableCap,
    excessConcessional,
    usedCarryForward: carryForwardResult.used,
    remainingCarryForward,
    nonConcessionalCapOpening,
    nonConcessionalCapMovement,
    nonConcessionalCapClosing,
    blockedNonConcessional,
    excessNonConcessional,
    contributionsTax,
    excessContributionsTax,
    newCarryForwardState,
    newNonConcessionalCapState,
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

/**
 * Initialize non-concessional cap state for persons
 * closingBalance = 0 means prior year was "reset" state (opening will be $120k)
 */
export function initializeNonConcessionalCapStates(persons: Person[]): Map<string, NonConcessionalCapState> {
  const states = new Map<string, NonConcessionalCapState>();
  
  for (const person of persons) {
    states.set(person.id, {
      personId: person.id,
      closingBalance: 0, // prior closing >= 0 → first year opening = cap
    });
  }
  
  return states;
}

/**
 * Create off-balance sheet items for cap accounts with opening/movement/closing display
 */
export function createCapAccountOffBalanceSheetItems(
  results: ContributionProcessingResult[],
  persons: Person[],
  _superSettings: SuperSettings = defaultSuperSettings
): OffBalanceSheetItem[] {
  const items: OffBalanceSheetItem[] = [];
  const personById = new Map(persons.map(p => [p.id, p]));
  
  for (const r of results) {
    const person = personById.get(r.personId);
    if (!person) continue;
    
    // Concessional cap account
    // Opening: availableCarryForward + concessionalCap (total available at start)
    const concessionalOpening = r.availableCarryForward + r.concessionalCap;
    const concessionalMovement = -r.concessionalContributions;
    const concessionalClosing = concessionalOpening + concessionalMovement;
    
    items.push({
      id: `conc-cap-${r.personId}`,
      type: 'concessionalCapAccount',
      label: `${person.name} - Concessional Cap`,
      personId: r.personId,
      opening: concessionalOpening,
      movement: concessionalMovement,
      closing: concessionalClosing,
      value: concessionalClosing,
    });
    
    // Non-concessional cap account (bring-forward)
    items.push({
      id: `nonconc-cap-${r.personId}`,
      type: 'nonConcessionalCapAccount',
      label: `${person.name} - Non-Concessional Cap`,
      personId: r.personId,
      opening: r.nonConcessionalCapOpening,
      movement: r.nonConcessionalCapMovement,
      closing: r.nonConcessionalCapClosing,
      value: r.nonConcessionalCapClosing,
    });
  }
  
  return items;
}
