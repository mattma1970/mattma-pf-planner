import { v4 as uuidv4 } from 'uuid';
import type {
  Account,
  Assumptions,
  Epoch,
  Event,
  Person,
  ResolvedAssumptions,
  ForecastResult,
  YearResult,
  AccountYearResult,
  Settings,
  TaxEvent,
  TaxAggregation,
  TaxSchedule,
  OffBalanceSheetItem,
  TaxByPerson,
  ForecastWarning,
} from '../schemas';
import { calculateIncomeTax, calculateCapitalGain, type CgtCalculationResult } from './tax';
import { resolveAssumptionForYear } from './assumptions';
import { isAccountActive, projectAccountValue, handleAccountTransfer, getAccountAcquisitionYear } from './accounts';
import {
  initializeCarryForwardStatesFromAccounts,
  initializeNonConcessionalCapStatesFromAccounts,
  aggregateContributionsByPerson,
  processPersonContributions,
  createCapAccountOffBalanceSheetItems,
  createTaxAccountYearResults,
  createFrankingCreditsYearResult,
  getContributionTaxCategory,
  isCapExempt,
  type CarryForwardState,
  type NonConcessionalCapState,
  type ContributionProcessingResult,
} from './superContributions';
import { calculateDiv293 } from './taxRules';
import {
  type LedgerEntry,
  emitLedgerEntry,
  applyDeferredLedger,
  checkConservation,
} from './ledger';
import { defaultSettings } from '../schemas/settings';

interface PendingCgtEvent {
  accountId: string;
  accountName: string;
  cgtResult: CgtCalculationResult;
  fundedFromAccountId: string;
  fundedFromAccountName: string;
  personId?: string;
  personName?: string;
}

interface CapitalLossState {
  personId: string;
  openingBalance: number;
  carryForwardBalance: number;
}

/**
 * Check if a periodic expense should occur in a given year.
 * Returns true if: (year - startYear) is divisible by occursEveryYears
 */
function isPeriodicExpenseYear(
  year: number,
  startYear: number,
  occursEveryYears: number
): boolean {
  const yearsSinceStart = year - startYear;
  return yearsSinceStart >= 0 && yearsSinceStart % occursEveryYears === 0;
}

/**
 * Calculate expense value for an account, handling balance-based and periodic expenses.
 * Returns the expense amount for this year (may be 0 for periodic expenses in off-years).
 */
function calculateExpenseValue(
  account: Account,
  year: number,
  baseValue: number,
  openingValues: Map<string, number>,
  accountStartYear: number,
  accounts: Account[],
  persons: Person[]
): { value: number; isPeriodicOffYear: boolean; basedOnValue?: number } {
  // Check if this is a periodic expense and if we're in an "off" year
  if (account.occursEveryYears) {
    if (!isPeriodicExpenseYear(year, accountStartYear, account.occursEveryYears)) {
      return { value: 0, isPeriodicOffYear: true };
    }
  }

  // Calculate the expense value
  let value = baseValue;
  let basedOnValue: number | undefined;

  // If balance-based, calculate from reference account's opening value
  if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
    const refAccount = accounts.find(a => a.id === account.basedOnAccountId);
    if (refAccount) {
      // Check if the reference account is active in this year
      const refAccountActive = isAccountActive(refAccount, year, persons);
      if (!refAccountActive) {
        // Reference account hasn't started yet or has ended - expense is 0
        return { value: 0, isPeriodicOffYear: false, basedOnValue: 0 };
      }
      
      // Get the reference account's opening value for this year (captured at start of year)
      basedOnValue = openingValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
      value = basedOnValue * account.basedOnPercentage;
    }
  }

  return { value, isPeriodicOffYear: false, basedOnValue };
}

export interface ForecastInput {
  accounts: Account[];
  assumptions: Assumptions;
  epochs: Epoch[];
  events: Event[];
  persons: Person[];
  settings: Settings;
  startYear: number;
  endYear: number;
}

/**
 * Transaction ordering per year:
 * 1. Carry opening balances (from previous year's closing)
 * 2. Account lifecycle moves (sell/transfer from endBehavior) - makes proceeds available
 * 3. User transfer events (explicit transfers between accounts)
 * 4. Apply growth (on balance after steps 1-3, skip if balance <= 0)
 * 5. Derived flows (income deposits, expense withdrawals, asset funding, tax)
 */
export function calculateForecast(input: ForecastInput): ForecastResult {
  const { accounts, assumptions, epochs, events, persons, settings, startYear, endYear } = input;
  
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

  const years: YearResult[] = [];
  const accountValues: Map<string, number> = new Map();
  const accountStartYears: Map<string, number> = new Map();
  
  // Track prior year inflows for income/expense accounts
  // Income/expense accounts always have opening balance = 0, but growth is based on prior year's inflows
  const priorYearInflows: Map<string, number> = new Map();

  accounts.forEach((account) => {
    accountValues.set(account.id, account.initialValue);
    // Initialize prior year inflows to initialValue for income/expense accounts
    if (account.type === 'income' || account.type === 'expense') {
      priorYearInflows.set(account.id, account.initialValue);
    }
  });

  let peakAssets = 0;
  let peakAssetsYear = startYear;
  
  // Initialize carry-forward state for super contributions (concessional)
  // Now reads opening balances from tax accounts if they exist
  let carryForwardStates = initializeCarryForwardStatesFromAccounts(persons, accounts, startYear, settings.super);
  // Initialize non-concessional cap state (bring-forward tracking)
  // Now reads opening balances from tax accounts if they exist
  let nonConcessionalCapStates = initializeNonConcessionalCapStatesFromAccounts(persons, accounts);
  
  // Initialize capital loss carry-forward state per person
  const capitalLossStates = new Map<string, CapitalLossState>();
  for (const person of persons) {
    capitalLossStates.set(person.id, {
      personId: person.id,
      openingBalance: 0,
      carryForwardBalance: 0,
    });
  }

  for (let year = startYear; year <= endYear; year++) {
    const resolvedAssumptions = resolveAssumptions(assumptions, year, sortedEpochs);
    const yearAccounts: AccountYearResult[] = [];
    const yearWarnings: ForecastWarning[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    const yearEvents = events.filter((e) => e.year === year);
    const pendingCgtEvents: PendingCgtEvent[] = [];
    const accountResults = new Map<string, AccountYearResult>();
    
    // Track per-account income for itemized tax events
    const incomeByAccount: { accountId: string; accountName: string; amount: number; fundedFromAccountId?: string; personId?: string; personName?: string }[] = [];
    
    // Track income by person for Div 293 calculation
    const incomeByPerson = new Map<string, number>();
    
    // Track franking credits generated for the year, per person (by asset owner)
    const frankingCreditsByPerson = new Map<string, number>();

    // ===========================================
    // PHASE 1: Calculate opening balances and identify lifecycle transfers
    // ===========================================
    
    // Update capital loss carry-forward opening balances for all persons
    // Opening balance = previous year's closing balance (carryForwardBalance)
    for (const state of capitalLossStates.values()) {
      state.openingBalance = state.carryForwardBalance;
    }
    
    // Capture opening values for all accounts at the start of the year
    // This is used for balance-based expense calculations
    // Income/expense accounts always start at 0 (they don't carry forward balances)
    const openingValues = new Map<string, number>();
    for (const account of accounts) {
      const isFirstActiveYear = !accountStartYears.has(account.id) && isAccountActive(account, year, persons);
      const opening = isFirstActiveYear
        ? account.initialValue
        : (account.type === 'income' || account.type === 'expense')
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);
      openingValues.set(account.id, opening);
    }
    
    // Snapshot of prior year inflows at year start (for derived income calculations)
    // This prevents order-of-processing issues where a reference account might
    // have its priorYearInflows updated before a derived account reads it
    const yearStartPriorInflows = new Map(priorYearInflows);
    
    // Check for incomplete employer SG accounts (only in first year to avoid repeated warnings)
    if (year === startYear) {
      for (const account of accounts) {
        // Check if this is a derived income account based on a salary account
        if (
          account.type === 'income' &&
          account.basedOnAccountId &&
          account.basedOnPercentage !== undefined &&
          !account.superContributionConfig
        ) {
          // Check if the source account is a salary account
          const sourceAccount = accounts.find(a => a.id === account.basedOnAccountId);
          if (sourceAccount?.type === 'income' && sourceAccount?.incomeSubType === 'salary') {
            yearWarnings.push({
              type: 'incompleteEmployerSg',
              severity: 'warning',
              message: `Employer SG account needs configuration`,
              details: `Select a target super account for: ${account.name}`,
              accountId: account.id,
            });
          }
        }
      }
    }
    
    // First pass: determine which accounts are ending and their transfer amounts
    const lifecycleTransfers: { 
      sourceId: string; 
      destinationId: string; 
      amount: number;
      endBehavior: 'transfer' | 'sell' | 'sellNoCgt';
      account: Account;
    }[] = [];

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = !accountStartYears.has(account.id) && isActive;
      
      if (isFirstActiveYear) {
        accountStartYears.set(account.id, year);
      }

      // Income/expense accounts start from 0 each year (they don't carry forward balances)
      // Other accounts carry forward their balance
      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (account.type === 'income' || account.type === 'expense')
          ? 0
          : (accountValues.get(account.id) ?? account.initialValue);

      // Check if this account ends this year with a transfer/sell
      if (isActive) {
        const transfer = handleAccountTransfer(account, year, persons, openingValue);
        if (transfer.isTransferYear && transfer.destinationId && transfer.endBehavior) {
          lifecycleTransfers.push({
            sourceId: account.id,
            destinationId: transfer.destinationId,
            amount: transfer.amount,
            endBehavior: transfer.endBehavior,
            account,
          });
        }
      }
    }

    // ===========================================
    // PHASE 2: Apply lifecycle transfers (sell/transfer from endBehavior)
    // These happen FIRST so proceeds are available for user transfers
    // ===========================================
    
    const lifecycleFlows = new Map<string, number>(); // accountId -> net change from lifecycle events
    
    for (const transfer of lifecycleTransfers) {
      // Source account loses its value
      lifecycleFlows.set(
        transfer.sourceId,
        (lifecycleFlows.get(transfer.sourceId) ?? 0) - transfer.amount
      );
      
      // Destination account gains the value
      lifecycleFlows.set(
        transfer.destinationId,
        (lifecycleFlows.get(transfer.destinationId) ?? 0) + transfer.amount
      );

      // Handle CGT for sell behavior (not for sellNoCgt)
      if (transfer.endBehavior === 'sell') {
        const account = transfer.account;
        const costBase = account.costBase ?? account.initialValue;
        const acquisitionYear = getAccountAcquisitionYear(account, persons);
        const eligibleForDiscount = account.eligibleForCgtDiscount ?? true;
        
        const cgtResult = calculateCapitalGain(
          transfer.amount,
          costBase,
          acquisitionYear,
          year,
          eligibleForDiscount
        );
        
        const fundingAccountId = account.taxFundedFromAccountId ?? settings.defaultTaxFundingAccountId ?? 'unassigned';
        const fundingAccount = accounts.find(a => a.id === fundingAccountId);
        const ownerPerson = account.owner ? persons.find(p => p.id === account.owner) : undefined;
        
        pendingCgtEvents.push({
          accountId: account.id,
          accountName: account.name,
          cgtResult,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: account.owner,
          personName: ownerPerson?.name,
        });
      }
      
      }
    
    // Track liability payoffs triggered by asset sales
    // The payoff will be processed as a normal withdrawal from the liability's fundedByAccountId
    const liabilityPayoffs = new Map<string, { 
      amount: number; 
      fundedByAccountId: string;
      triggeredByAssetId: string;
      triggeredByAssetName: string;
      liabilityName: string;
    }>();
    
    // Identify liabilities to pay off when their linked asset sells (for both 'sell' and 'sellNoCgt')
    for (const transfer of lifecycleTransfers) {
      if (transfer.endBehavior === 'sell' || transfer.endBehavior === 'sellNoCgt') {
        const account = transfer.account;
        for (const liability of accounts) {
          if (liability.type === 'liability' && liability.payoffFromAccountId === account.id) {
            const liabilityBalance = accountValues.get(liability.id) ?? liability.initialValue;
            if (liabilityBalance > 0 && liability.fundedByAccountId) {
              // Track the payoff - will be processed in Phase 6 as a withdrawal from fundedByAccountId
              liabilityPayoffs.set(liability.id, {
                amount: liabilityBalance,
                fundedByAccountId: liability.fundedByAccountId,
                triggeredByAssetId: account.id,
                triggeredByAssetName: account.name,
                liabilityName: liability.name,
              });
            }
          }
        }
      }
    }

    // ===========================================
    // PHASE 3: Apply user transfer events and super contributions
    // These happen AFTER lifecycle transfers, so proceeds are available
    // ===========================================
    
    const userTransferFlows = new Map<string, number>(); // accountId -> net change from user transfers
    
    // Track super contributions for this year (for tax calculations)
    const superContributionsByAccount = new Map<string, { 
      concessional: number; 
      nonConcessional: number; 
      preTaxReduction: number;   // Salary sacrifice - excess is added back to income
      postTaxDeduction: number;  // Personal deductible - only cap amount is deductible
      personId: string;
    }>();
    
    // Track super contribution flows separately from transfers (for proper reporting as contributions)
    const superContributionFlows = new Map<string, number>(); // accountId -> contribution amount
    
    // Pre-calculate blocked/excess contributions per person
    // This allows us to adjust flows when contributions can't be made
    // - blockedNonConcessional: when non-conc opening cap <= 0, contributions are blocked
    // - excessNonConcessional: when contributions exceed 3-year bring-forward limit
    // Note: blocked/excess includes BOTH explicit non-concessional AND excess from concessional
    const contributionCapResultsByPerson = new Map<string, {
      // For non-concessional contributions
      unallowedNonConcessional: number;
      totalRequestedNonConcessional: number;
      // For concessional contributions (excess that flows to non-concessional)
      excessConcessional: number;
      blockedExcessConcessional: number;
      totalRequestedConcessional: number;
    }>();
    if (persons.length > 0 && settings.super) {
      const contributionsByPerson = aggregateContributionsByPerson(events, year, persons, accounts);
      
      for (const person of persons) {
        const personContribs = contributionsByPerson.get(person.id);
        const currentCarryForwardState = carryForwardStates.get(person.id) ?? { 
          personId: person.id, 
          unusedCaps: [] 
        };
        const currentNonConcCapState = nonConcessionalCapStates.get(person.id) ?? {
          personId: person.id,
          closingBalance: 0,
        };
        
        const result = processPersonContributions(
          person.id,
          year,
          personContribs?.concessional ?? 0,
          personContribs?.nonConcessional ?? 0,
          currentCarryForwardState,
          currentNonConcCapState,
          settings.super
        );
        
        // Total blocked/excess for non-concessional cap
        const totalUnallowed = result.blockedNonConcessional + result.excessNonConcessional;
        
        // Calculate how much of the blocked/excess applies to each source:
        // - Explicit non-concessional contributions
        // - Excess from concessional contributions
        // The blocking is applied proportionally based on what contributed to the cap usage
        const totalForNonConcCap = (personContribs?.nonConcessional ?? 0) + result.excessConcessional;
        
        let unallowedNonConcessional = 0;
        let blockedExcessConcessional = 0;
        
        if (totalUnallowed > 0 && totalForNonConcCap > 0) {
          // Pro-rate the blocked amount between explicit non-conc and excess concessional
          const nonConcRatio = (personContribs?.nonConcessional ?? 0) / totalForNonConcCap;
          const excessConcRatio = result.excessConcessional / totalForNonConcCap;
          
          unallowedNonConcessional = totalUnallowed * nonConcRatio;
          blockedExcessConcessional = totalUnallowed * excessConcRatio;
        }
        
        contributionCapResultsByPerson.set(person.id, {
          unallowedNonConcessional,
          totalRequestedNonConcessional: personContribs?.nonConcessional ?? 0,
          excessConcessional: result.excessConcessional,
          blockedExcessConcessional,
          totalRequestedConcessional: personContribs?.concessional ?? 0,
        });
        
        // Generate consolidated warnings for blocked contributions (per person)
        const totalBlocked = unallowedNonConcessional + blockedExcessConcessional;
        if (totalBlocked > 0) {
          const parts: string[] = [];
          if (unallowedNonConcessional > 0) {
            parts.push(`$${Math.round(unallowedNonConcessional).toLocaleString()} non-concessional`);
          }
          if (blockedExcessConcessional > 0) {
            parts.push(`$${Math.round(blockedExcessConcessional).toLocaleString()} excess concessional`);
          }
          
          yearWarnings.push({
            type: 'blockedContribution',
            severity: 'warning',
            message: `Super contribution blocked for ${person.name}`,
            details: `${parts.join(' and ')} blocked - non-concessional cap exhausted`,
            personId: person.id,
            amount: totalBlocked,
          });
        }
      }
    }
    
    for (const event of yearEvents) {
      if (event.type === 'transfer' && event.sourceAccountId && event.targetAccountId) {
        // For transferAll, we need to calculate the balance at this point
        // (opening + lifecycle flows)
        let transferAmount = event.amount;
        if (event.transferAll) {
          const sourceAccount = accounts.find(a => a.id === event.sourceAccountId);
          if (sourceAccount) {
            const isFirstActive = !accountStartYears.has(event.sourceAccountId) && isAccountActive(sourceAccount, year, persons);
            const openingValue = isFirstActive
              ? sourceAccount.initialValue
              : (accountValues.get(event.sourceAccountId) ?? sourceAccount.initialValue);
            const lifecycleChange = lifecycleFlows.get(event.sourceAccountId) ?? 0;
            transferAmount = openingValue + lifecycleChange;
          }
        }
        
        userTransferFlows.set(
          event.sourceAccountId,
          (userTransferFlows.get(event.sourceAccountId) ?? 0) - transferAmount
        );
        userTransferFlows.set(
          event.targetAccountId,
          (userTransferFlows.get(event.targetAccountId) ?? 0) + transferAmount
        );
      }
      
      // Handle super contribution events
      if (event.type === 'superContribution' && event.superContribution && event.targetAccountId) {
        const { contributionType, memberPersonId, reducesAssessableIncome, source } = event.superContribution;
        const exemptFromCap = event.superContribution.exemptFromCap ?? isCapExempt(contributionType);
        
        // Derive personId from the super account's owner, fallback to memberPersonId
        const targetAccount = accounts.find(a => a.id === event.targetAccountId);
        const personId = targetAccount?.owner || memberPersonId;
        
        // Map contribution types (including cap-exempt types) to concessional/nonConcessional
        const taxCategory = getContributionTaxCategory(contributionType);
        
        // Calculate effective contribution amount (may be reduced if blocked/excess by cap)
        let effectiveAmount = event.amount;
        
        if (!exemptFromCap && personId) {
          const capResult = contributionCapResultsByPerson.get(personId);
          
          if (capResult) {
            if (taxCategory === 'nonConcessional') {
              // Direct non-concessional: apply blocking based on non-concessional cap
              if (capResult.unallowedNonConcessional > 0 && capResult.totalRequestedNonConcessional > 0) {
                const unallowedRatio = capResult.unallowedNonConcessional / capResult.totalRequestedNonConcessional;
                const unallowedForThisEvent = event.amount * unallowedRatio;
                effectiveAmount = event.amount - unallowedForThisEvent;
              }
            } else if (taxCategory === 'concessional') {
              // Concessional: the excess portion flows to non-concessional cap
              // If that excess is blocked, reduce the effective amount
              if (capResult.blockedExcessConcessional > 0 && capResult.totalRequestedConcessional > 0) {
                // Pro-rate the blocked excess across all concessional contributions
                const blockedRatio = capResult.blockedExcessConcessional / capResult.totalRequestedConcessional;
                const blockedForThisEvent = event.amount * blockedRatio;
                effectiveAmount = event.amount - blockedForThisEvent;
              }
            }
          }
        }
        
        // Track contribution to target super account separately (not as a transfer)
        superContributionFlows.set(
          event.targetAccountId,
          (superContributionFlows.get(event.targetAccountId) ?? 0) + effectiveAmount
        );
        
        // If there's a source account (salary sacrifice, personal contribution), deduct as transfer
        // Only deduct the effective amount (not the blocked portion)
        if (event.sourceAccountId) {
          userTransferFlows.set(
            event.sourceAccountId,
            (userTransferFlows.get(event.sourceAccountId) ?? 0) - effectiveAmount
          );
        }
        
        // Track contributions by super account for tax calculations
        const existing = superContributionsByAccount.get(event.targetAccountId) ?? { 
          concessional: 0, 
          nonConcessional: 0, 
          preTaxReduction: 0,    // Salary sacrifice - excess is added back to income
          postTaxDeduction: 0,   // Personal deductible - only cap amount is deductible
          personId 
        };
        if (taxCategory === 'concessional') {
          existing.concessional += event.amount;
          // Track income reduction separately for pre-tax vs post-tax contributions
          if (reducesAssessableIncome) {
            if (source === 'salarySacrifice') {
              // Pre-tax: salary sacrifice already reduced gross income
              existing.preTaxReduction += event.amount;
            } else {
              // Post-tax: personal deductible or any other source with reducesAssessableIncome
              // (includes personal contributions when marked as concessional)
              existing.postTaxDeduction += event.amount;
            }
          }
        } else {
          existing.nonConcessional += effectiveAmount;
        }
        superContributionsByAccount.set(event.targetAccountId, existing);
      }
    }

    // ===========================================
    // PHASE 4 & 5: Process each account - apply growth and derived flows
    // ===========================================
    
    // All ledger entries applied this year (for conservation check)
    const yearLedgerEntries: LedgerEntry[] = [];
    // Phase-5 entries deferred until after the account processing loop
    const deferredLedgerEntries: LedgerEntry[] = [];

    const ledgerError = (msg: string): void => {
      yearWarnings.push({ type: 'ledgerError', severity: 'error', message: msg });
    };

    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = accountStartYears.get(account.id) === year;
      const isLifecycleEnding = lifecycleTransfers.some(t => t.sourceId === account.id);

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (accountValues.get(account.id) ?? account.initialValue);

      // Get flow amounts
      const lifecycleChange = lifecycleFlows.get(account.id) ?? 0;
      const userTransferChange = userTransferFlows.get(account.id) ?? 0;
      const superContributionChange = superContributionFlows.get(account.id) ?? 0;

      let growth = 0;
      let projectedValue = openingValue;
      let contributions = 0;
      let withdrawals = 0;
      let transfers = 0;
      let endValue = openingValue;
      
      // Track lifecycle transfers: outflows as transfers, inflows as contributions
      const lifecycleContribution = Math.max(0, lifecycleChange);
      if (lifecycleChange < 0) {
        transfers = lifecycleChange; // Outflow (source account)
      } else if (lifecycleChange > 0) {
        contributions = lifecycleChange; // Inflow (destination account) - for reporting
      }
      
      // Track user transfers as transfers (both in and out)
      transfers += userTransferChange;
      
      // Track super contributions as contributions (not transfers)
      contributions += superContributionChange;

      if (isActive && !isLifecycleEnding) {
        // Calculate balance for growth based on settings.growthCalculationMethod
        const totalTransfers = lifecycleChange + userTransferChange + superContributionChange;
        let balanceForGrowth: number;
        
        if (settings.growthCalculationMethod === 'averageBalance') {
          // Average balance: opening + 0.5 * all transfers (assumes mid-year transactions)
          balanceForGrowth = openingValue + 0.5 * totalTransfers;
        } else {
          // Opening balance (default): opening + lifecycle outflows only (inflows added after growth)
          balanceForGrowth = openingValue + Math.min(0, lifecycleChange) + userTransferChange;
        }
        
        // PHASE 4: Apply growth (only if balance > 0)
        // Skip growth for liabilities - interest is handled separately in liability processing phase
        if (account.type === 'liability') {
          // For liabilities, check if it will be paid off via asset sale (handled in Phase 6)
          const payoffInfo = liabilityPayoffs.get(account.id);
          if (payoffInfo) {
            // Liability will be paid off from asset sale - skip normal processing
            // The actual payoff withdrawal is handled in Phase 6
            projectedValue = openingValue;
            endValue = openingValue;
            growth = 0;
          } else {
            // Normal liability processing - interest handled in liability phase
            // For liabilities, transfers TO the account reduce the balance (paying down the loan)
            // So we subtract userTransferChange instead of adding it
            projectedValue = openingValue + lifecycleChange - userTransferChange;
            growth = 0;
          }
        } else if (account.type === 'expense') {
          // Special handling for expense accounts with balance-based or periodic features
          const accountStartYear = accountStartYears.get(account.id) ?? year;
          const yearsSinceStart = year - accountStartYear + 1;
          
          // For periodic expenses, we need to calculate the "notional" value with growth
          // even in off-years, so the expense value is correct when it does occur.
          // Use the account's initial value as the base, grown by yearsSinceStart years.
          let grownBaseValue: number;
          if (account.occursEveryYears) {
            // For periodic expenses, always grow from initial value
            // This ensures the expense amount is correct regardless of off-years
            const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            grownBaseValue = projectAccountValue(account, year, account.initialValue, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
            // Compound for all years since start
            for (let y = 1; y < yearsSinceStart; y++) {
              grownBaseValue = projectAccountValue(account, year, grownBaseValue, resolvedAssumptions, y + 1, epochGrowthOverride);
            }
            // Recalculate properly: initial * (1 + rate)^yearsSinceStart
            const epochGrowth = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            // Use simpler compound growth
            let rate = 0;
            if (account.growthProfile.type === 'fixed') {
              rate = epochGrowth ?? account.growthProfile.rate;
            } else if (account.growthProfile.type === 'cpiLinked') {
              const cpiValue = epochGrowth ?? account.growthProfile.value ?? 0;
              rate = resolvedAssumptions.cpi + cpiValue;
            }
            grownBaseValue = account.initialValue * Math.pow(1 + rate, yearsSinceStart - 1);
          } else if (balanceForGrowth > 0) {
            const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            grownBaseValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
          } else {
            grownBaseValue = balanceForGrowth;
          }
          
          // Then apply expense-specific calculations (balance-based, periodic)
          const expenseResult = calculateExpenseValue(
            account,
            year,
            grownBaseValue,
            openingValues,
            accountStartYear,
            accounts,
            persons
          );
          
          projectedValue = expenseResult.value;
          growth = projectedValue - openingValue;
        } else if (account.type === 'income') {
          // Income accounts: growth is based on prior year's inflows, not opening balance
          // This makes growth intuitive: if salary was $100k last year with 3% growth, this year it's $103k
          
          // Check if this is a derived income account (e.g., employer SG based on salary)
          if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
            // Derived income: calculate as a percentage of the reference account's value for this year
            const refAccount = accounts.find(a => a.id === account.basedOnAccountId);
            if (refAccount) {
              // Check if the reference account is active in this year
              const refAccountActive = isAccountActive(refAccount, year, persons);
              if (!refAccountActive) {
                // Reference account hasn't started yet or has ended - derived income is 0
                projectedValue = 0;
                growth = 0;
              } else {
                // For income-based derivation (e.g., employer SG from salary):
                // Get the reference income account's projected value for this year
                // We need to calculate what the reference account's value would be
                let refValue = 0;
                if (refAccount.type === 'income') {
                  // For income accounts, calculate what their value would be this year
                  // Use yearStartPriorInflows to avoid issues with processing order
                  const refPriorInflows = yearStartPriorInflows.get(refAccount.id) ?? refAccount.initialValue;
                  const refIsFirstActive = accountStartYears.get(refAccount.id) === year;
                  if (refIsFirstActive) {
                    refValue = refAccount.initialValue;
                  } else if (refPriorInflows > 0) {
                    const refYearsSinceStart = year - (accountStartYears.get(refAccount.id) ?? year) + 1;
                    const refEpochGrowthOverride = getAccountAssumptionForEpoch(refAccount, year, sortedEpochs, 'growthRate');
                    refValue = projectAccountValue(refAccount, year, refPriorInflows, resolvedAssumptions, refYearsSinceStart, refEpochGrowthOverride);
                  }
                } else {
                  // For asset/liability accounts, use opening value
                  refValue = openingValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
                }
                
                projectedValue = refValue * account.basedOnPercentage;
                growth = projectedValue; // All value is "new" each year for pass-through accounts
              }
            } else {
              projectedValue = 0;
              growth = 0;
            }
          } else if (isFirstActiveYear) {
            // First active year: use initialValue directly (no growth yet)
            projectedValue = account.initialValue;
            growth = 0;
          } else {
            const priorInflows = priorYearInflows.get(account.id) ?? account.initialValue;
            if (priorInflows > 0) {
              const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
              const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
              projectedValue = projectAccountValue(account, year, priorInflows, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
              growth = projectedValue - priorInflows;
            } else {
              projectedValue = 0;
              growth = 0;
            }
          }
        } else if (balanceForGrowth > 0) {
          const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
          const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
          projectedValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
          growth = projectedValue - balanceForGrowth;
        } else {
          // No growth on zero or negative balances
          projectedValue = balanceForGrowth;
          growth = 0;
        }
        
        // Add remaining transfer amounts not included in growth base
        if (settings.growthCalculationMethod === 'averageBalance') {
          // For average balance, the full transfer is already factored in via 0.5 multiplier
          // Add the other half that wasn't in the growth base
          projectedValue += 0.5 * totalTransfers;
        } else {
          // For opening balance method, add lifecycle inflows and super contributions after growth
          projectedValue += lifecycleContribution + superContributionChange;
        }

        // Process non-transfer events (contributions/withdrawals) - don't add to contributions again
        let eventContributions = 0;
        let eventWithdrawals = 0;
        for (const event of yearEvents) {
          if (event.affectedAccountId === account.id) {
            if (event.type === 'income' || event.type === 'assetChange') {
              eventContributions += event.amount;
            } else if (event.type === 'expense' || event.type === 'liabilityChange') {
              eventWithdrawals += event.amount;
            }
          }
        }
        contributions += eventContributions;
        withdrawals += eventWithdrawals;

        // Set endValue (unless liability was paid off via asset sale)
        const wasLiabilityPaidOff = account.type === 'liability' && liabilityPayoffs.has(account.id);
        if (!wasLiabilityPaidOff) {
          endValue = projectedValue + eventContributions - eventWithdrawals;
        }

        // PHASE 5: Derived flows
        if (account.type === 'income') {
          const totalIncomeValue = projectedValue + contributions;
          
          if (account.superContributionConfig && totalIncomeValue > 0) {
            // This is a derived income account that flows to super (e.g., employer SG)
            // Route to the target super account as a contribution
            const config = account.superContributionConfig;
            const targetSuperAccount = accounts.find(a => a.id === config.targetSuperAccountId);
            const personId = account.owner ?? targetSuperAccount?.owner;
            
            // Track contribution for super cap calculations
            const taxCategory = getContributionTaxCategory(config.contributionType);
            const effectivePersonId = personId ?? 'unassigned';
            const existing = superContributionsByAccount.get(config.targetSuperAccountId) ?? {
              concessional: 0,
              nonConcessional: 0,
              preTaxReduction: 0,
              postTaxDeduction: 0,
              personId: effectivePersonId,
            };
            
            if (taxCategory === 'concessional') {
              existing.concessional += totalIncomeValue;
              if (config.reducesAssessableIncome) {
                if (config.source === 'salarySacrifice') {
                  existing.preTaxReduction += totalIncomeValue;
                } else {
                  existing.postTaxDeduction += totalIncomeValue;
                }
              }
            } else {
              existing.nonConcessional += totalIncomeValue;
            }
            superContributionsByAccount.set(config.targetSuperAccountId, existing);
            
            // Note: We do NOT add to superContributionFlows here because it's too late -
            // the target super account has already been processed in this loop.
            // Instead, we use derivedFlows which are applied after all accounts are processed.
            
            // Add deferred ledger entry for the target super account
            // Employer SG and similar contributions are external money entering the model
            deferredLedgerEntries.push({
              accountId: config.targetSuperAccountId,
              amount: totalIncomeValue,
              delta: 'credit',
              kind: 'externalIn',
              label: `${config.source === 'employerSG' ? 'Employer SG' : config.source}: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          } else if (totalIncomeValue > 0) {
            if (account.drawnFromAccountId && account.depositsToAccountId) {
              // Pension/AP drawdown: internal transfer from the source asset to the cash account.
              // Both sides emitted so the transfer balance check can verify they match.
              deferredLedgerEntries.push({
                accountId: account.drawnFromAccountId,
                amount: totalIncomeValue,
                delta: 'debit',
                kind: 'internalTransfer',
                label: `Drawdown source: ${account.name}`,
                sourceAccountId: account.id,
                sourceAccountName: account.name,
              });
              deferredLedgerEntries.push({
                accountId: account.depositsToAccountId,
                amount: totalIncomeValue,
                delta: 'credit',
                kind: 'internalTransfer',
                label: `Drawdown: ${account.name}`,
                sourceAccountId: account.id,
                sourceAccountName: account.name,
              });
            } else if (account.depositsToAccountId) {
              // Standard income (salary, rent, etc.) — money entering from the real world
              deferredLedgerEntries.push({
                accountId: account.depositsToAccountId,
                amount: totalIncomeValue,
                delta: 'credit',
                kind: 'externalIn',
                label: `Income: ${account.name}`,
                sourceAccountId: account.id,
                sourceAccountName: account.name,
              });
            }
            // Note: if depositsToAccountId IS set but the account doesn't exist, the ledger
            // apply step above will emit a ledgerError warning. If no depositsToAccountId is
            // set at all (e.g. income not yet wired up), no warning is needed — the income
            // simply isn't routed anywhere, which may be intentional during plan construction.
          }
        }
        if (account.type === 'expense' && account.fundedByAccountId) {
          deferredLedgerEntries.push({
            accountId: account.fundedByAccountId,
            amount: projectedValue,
            delta: 'debit',
            kind: 'externalOut',
            label: `Expense: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
        if (account.type === 'asset' && account.incomeTargetAccountId && balanceForGrowth > 0) {
          const epochReturnOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'returnRate');
          const effectiveReturnRate = epochReturnOverride ?? account.returnRate;
          if (effectiveReturnRate) {
            // Determine balance for return calculation based on returnBalanceMethod (default: average)
            const balanceMethod = account.returnBalanceMethod ?? 'average';
            let balanceForReturn: number;
            
            switch (balanceMethod) {
              case 'opening':
                balanceForReturn = openingValue;
                break;
              case 'closing':
                balanceForReturn = endValue; // Closing before adjustments
                break;
              case 'average':
              default:
                balanceForReturn = (openingValue + endValue) / 2;
                break;
            }
            
            const cashReturn = balanceForReturn * effectiveReturnRate;
            
            // Calculate franking credits if franking percentage is set
            const frankingPercentage = account.frankingPercentage ?? 0;
            const companyTaxRate = settings.companyTaxRate ?? 0.30;
            
            let grossedUpReturn = cashReturn;
            let frankingCredits = 0;
            
            if (frankingPercentage > 0 && companyTaxRate > 0) {
              // Only the franked portion gets grossed up
              const frankedPortion = cashReturn * frankingPercentage;
              const unfrankedPortion = cashReturn - frankedPortion;
              
              // Gross up the franked portion: grossUp = cashAmount / (1 - companyTaxRate)
              const grossedUpFrankedPortion = frankedPortion / (1 - companyTaxRate);
              frankingCredits = grossedUpFrankedPortion - frankedPortion;
              
              grossedUpReturn = grossedUpFrankedPortion + unfrankedPortion;
              
              // Track franking credits by the asset owner
              const ownerId = account.owner ?? 'unassigned';
              frankingCreditsByPerson.set(ownerId, (frankingCreditsByPerson.get(ownerId) ?? 0) + frankingCredits);
            }
            
            // Deposit the grossed up amount to the income account (this becomes taxable income).
            // The return is new wealth created by the market, classified as synthetic.
            deferredLedgerEntries.push({
              accountId: account.incomeTargetAccountId,
              amount: grossedUpReturn,
              delta: 'credit',
              kind: 'synthetic',
              label: `Return: ${account.name}${frankingCredits > 0 ? ' (grossed up)' : ''}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
        if (account.type === 'asset' && account.fundedByAccountId) {
          // Only fund the initial value and user-initiated contributions
          // Lifecycle transfers (e.g., super to pension) are already funded by their source
          // Super contributions have their own source accounts
          // So fundedBy should only cover: initialValue (first year) + other contributions not from transfers
          const userContributions = contributions - lifecycleContribution - superContributionChange;
          let fundingAmount = userContributions - withdrawals;
          if (isFirstActiveYear) {
            fundingAmount += account.initialValue;
          }
          if (fundingAmount > 0) {
            // Bank funds the asset purchase — internal transfer (asset credit is implicit in account processing)
            deferredLedgerEntries.push({
              accountId: account.fundedByAccountId,
              amount: fundingAmount,
              delta: 'debit',
              kind: 'internalTransfer',
              label: `Fund asset: ${account.name}`,
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
      } else if (isLifecycleEnding) {
        // Account ended this year via transfer/sell - its opening balance was moved out,
        // but it may still receive income deposits that should accumulate
        endValue = contributions;
        projectedValue = contributions;
      } else if (!isActive) {
        // Account not active
        if (account.endBehavior === 'hold') {
          endValue = openingValue;
          projectedValue = openingValue;
        } else if (account.endBehavior === 'transfer' || account.endBehavior === 'sell') {
          // After transfer/sell, keep accumulated contributions (e.g., income deposits)
          endValue = openingValue + contributions;
          projectedValue = openingValue + contributions;
        } else {
          // 'zero' or default - set to zero
          endValue = 0;
          projectedValue = 0;
        }

        if (account.type === 'income' && account.depositsToAccountId && account.endBehavior === 'hold') {
          deferredLedgerEntries.push({
            accountId: account.depositsToAccountId,
            amount: projectedValue,
            delta: 'credit',
            kind: 'externalIn',
            label: `Income (held): ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
        if (account.type === 'expense' && account.fundedByAccountId && account.endBehavior === 'hold') {
          deferredLedgerEntries.push({
            accountId: account.fundedByAccountId,
            amount: projectedValue,
            delta: 'debit',
            kind: 'externalOut',
            label: `Expense (held): ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }

      accountValues.set(account.id, endValue);

      if (account.type === 'income') {
        // All income accounts: taxable income is projectedValue + contributions
        const taxableIncome = projectedValue + contributions;
        totalIncome += taxableIncome;
        // Track income per account for itemized tax events (skip tax-free income)
        // Also skip derived income that routes directly to super (superContributionConfig)
        // as it's not assessable income for the person
        const isDerivedSuperIncome = !!account.superContributionConfig;
        if (taxableIncome > 0 && account.incomeTaxTreatment !== 'taxFree' && !isDerivedSuperIncome) {
          const ownerPerson = account.owner ? persons.find(p => p.id === account.owner) : undefined;
          incomeByAccount.push({
            accountId: account.id,
            accountName: account.name,
            amount: taxableIncome,
            fundedFromAccountId: account.taxFundedFromAccountId,
            personId: account.owner,
            personName: ownerPerson?.name,
          });
          // Track income by person for Div 293 calculation
          if (account.owner) {
            incomeByPerson.set(account.owner, (incomeByPerson.get(account.owner) ?? 0) + taxableIncome);
          }
        }
        // Income accounts show total income for the year as endValue
        endValue = taxableIncome;
        // Track inflows for next year's growth calculation
        priorYearInflows.set(account.id, taxableIncome);
      } else if (account.type === 'expense') {
        totalExpenses += projectedValue;
        // Track expense value for next year's growth calculation
        priorYearInflows.set(account.id, projectedValue);
      }

      accountResults.set(account.id, {
        accountId: account.id,
        year,
        startValue: openingValue,
        growth,
        contributions,
        withdrawals,
        transfers,
        endValue,
      });
    }

    // Handle events without affected accounts
    for (const event of yearEvents) {
      if (!event.affectedAccountId && !event.sourceAccountId) {
        if (event.type === 'income') {
          totalIncome += event.amount;
        } else if (event.type === 'expense') {
          totalExpenses += event.amount;
        }
      }
    }

    // Apply deferred Phase-5 ledger entries (strict: reports error if account missing)
    applyDeferredLedger(deferredLedgerEntries, yearLedgerEntries, accountResults, accountValues, ledgerError);

    // Tax handling for synthetic return entries
    // Returns are deposited to the income target account via ledger entries (kind: 'synthetic').
    // For tax purposes, returns should be attributed to the SOURCE asset account.
    for (const entry of deferredLedgerEntries) {
      if (entry.kind !== 'synthetic') continue;
      if (!entry.sourceAccountId) continue;

      const sourceAccount = accounts.find(a => a.id === entry.sourceAccountId);
      if (!sourceAccount) continue;

      const isTaxable = (sourceAccount.returnTaxTreatment ?? 'asIncome') !== 'taxFree';
      if (!isTaxable) continue;

      if (sourceAccount.owner) {
        incomeByPerson.set(sourceAccount.owner, (incomeByPerson.get(sourceAccount.owner) ?? 0) + entry.amount);
      }
      totalIncome += entry.amount;

      const fundingAccountId = sourceAccount.taxFundedFromAccountId ?? settings.defaultTaxFundingAccountId;
      if (fundingAccountId) {
        incomeByAccount.push({
          accountId: sourceAccount.id,
          accountName: sourceAccount.name,
          amount: entry.amount,
          fundedFromAccountId: fundingAccountId,
          personId: sourceAccount.owner,
          personName: sourceAccount.owner ? persons.find(p => p.id === sourceAccount.owner)?.name : undefined,
        });
      }
    }

    // ===========================================
    // PHASE 6: Liability interest and payment processing
    // ===========================================
    
    for (const account of accounts) {
      if (account.type !== 'liability') continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      // Check if this liability is being paid off via asset sale
      const payoffInfo = liabilityPayoffs.get(account.id);
      if (payoffInfo) {
        // Liability paid off from asset sale proceeds — internal transfer (NW-neutral)
        emitLedgerEntry(
          {
            accountId: payoffInfo.fundedByAccountId,
            amount: payoffInfo.amount,
            delta: 'debit',
            kind: 'internalTransfer',
            label: `Payoff: ${payoffInfo.liabilityName}`,
            sourceAccountId: account.id,
            sourceAccountName: payoffInfo.liabilityName,
          },
          yearLedgerEntries,
          accountResults,
          accountValues,
          ledgerError,
        );
        // Zero out the liability
        result.withdrawals = payoffInfo.amount;
        result.endValue = 0;
        accountValues.set(account.id, 0);
        continue; // Skip normal liability processing
      }
      
      // Skip if liability is already paid off
      if (result.endValue <= 0) continue;
      
      const interestRate = account.interestRate ?? 0;
      
      // Determine balance for interest calculation based on interestBalanceMethod (default: average)
      const balanceMethod = account.interestBalanceMethod ?? 'average';
      let balanceForInterest: number;
      
      switch (balanceMethod) {
        case 'opening':
          balanceForInterest = result.startValue;
          break;
        case 'closing':
          balanceForInterest = result.endValue;
          break;
        case 'average':
        default:
          balanceForInterest = (result.startValue + result.endValue) / 2;
          break;
      }
      
      // Calculate effective balance for interest (considering offset account)
      // Only positive offset balances reduce the effective loan balance
      let effectiveBalance = balanceForInterest;
      if (account.offsetAccountId) {
        const offsetResult = accountResults.get(account.offsetAccountId);
        if (offsetResult) {
          const offsetBalance = Math.max(0, offsetResult.endValue); // Ignore negative balances
          effectiveBalance = Math.max(0, balanceForInterest - offsetBalance);
        }
      }
      
      // Calculate interest
      const interestAmount = effectiveBalance * interestRate;
      
      // Calculate payment amount
      let paymentAmount = account.annualPayment ?? 0;
      
      if (account.calculatePayment && account.endCondition) {
        // Auto-calculate payment to pay off by end date using amortization formula
        // Use effective balance (considering offset) for accurate payment calculation
        const owner = persons.find(p => p.id === account.owner);
        let endYear: number;
        if (account.endCondition.type === 'year') {
          endYear = account.endCondition.year;
        } else if (account.endCondition.type === 'age' && owner) {
          endYear = owner.birthYear + account.endCondition.age;
        } else {
          endYear = year + 30; // Default to 30 years if no end condition
        }
        
        const yearsRemaining = Math.max(1, endYear - year + 1);
        
        // Calculate payment needed to pay off the FULL balance by end date,
        // but using the EFFECTIVE interest rate (reduced by offset)
        // This gives the correct payment: interest on effective balance + principal reduction
        if (interestRate > 0 && effectiveBalance > 0) {
          // With offset account: interest is charged on effective balance,
          // but we're paying down the full principal
          const principalToPay = result.endValue;
          
          // Calculate required principal payment per year to pay off by end date
          // Payment = principal / years remaining + interest on effective balance
          const principalPaymentPerYear = principalToPay / yearsRemaining;
          paymentAmount = principalPaymentPerYear + interestAmount;
        } else if (interestRate > 0) {
          // Effective balance is 0 (offset >= balance), just pay principal
          paymentAmount = result.endValue / yearsRemaining;
        } else {
          // No interest: simple division
          paymentAmount = result.endValue / yearsRemaining;
        }
      }
      
      // For interest-only, payment only covers interest
      if (account.paymentType === 'interestOnly') {
        paymentAmount = interestAmount;
      }
      
      // Cap payment at remaining balance + interest (don't overpay)
      const maxPayment = result.endValue + interestAmount;
      paymentAmount = Math.min(paymentAmount, maxPayment);
      
      // Calculate principal reduction
      // For interest-only, the payment covers interest so principal unchanged
      // For P&I, the payment covers interest + principal reduction
      const principalReduction = account.paymentType === 'interestOnly' 
        ? 0 
        : Math.max(0, paymentAmount - interestAmount);
      
      // Update liability balance
      // Interest is tracked for display but the net balance change depends on payment type
      result.growth = interestAmount; // Interest accrued (shown for transparency)
      result.withdrawals = principalReduction; // Principal reduction
      
      // For interest-only: balance stays same (interest is paid off each year)
      // For P&I: balance = balance + interest - payment = balance - principal reduction
      if (account.paymentType === 'interestOnly') {
        // Interest paid, balance unchanged
        result.endValue = result.endValue;
      } else {
        // P&I: add interest, subtract the full payment, but cap at not going negative
        result.endValue = Math.max(0, result.endValue + interestAmount - paymentAmount);
      }
      accountValues.set(account.id, result.endValue);
      
      // Withdraw payment from funding account
      // Interest portion leaves the model (externalOut); principal portion is internal.
      // We use externalOut for the full payment — the principal reduction is visible
      // via the liability's own endValue decrease (captured in conservation as NW change).
      if (account.fundedByAccountId && paymentAmount > 0) {
        emitLedgerEntry(
          {
            accountId: account.fundedByAccountId,
            amount: paymentAmount,
            delta: 'debit',
            kind: 'externalOut',
            label: `Liability payment: ${account.name}`,
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          },
          yearLedgerEntries,
          accountResults,
          accountValues,
          ledgerError,
        );
      }
    }

    // ===========================================
    // PHASE 7: Tax calculations
    // ===========================================
    
    const taxEvents: TaxEvent[] = [];
    
    const defaultFundingAccountId = settings.defaultTaxFundingAccountId ?? 'unassigned';
    const defaultFundingAccount = settings.defaultTaxFundingAccountId 
      ? accounts.find(a => a.id === settings.defaultTaxFundingAccountId) 
      : undefined;

    // Generate per-account income tax events
    for (const income of incomeByAccount) {
      const fundingAccountId = income.fundedFromAccountId ?? defaultFundingAccountId;
      const fundingAccount = income.fundedFromAccountId
        ? accounts.find(a => a.id === income.fundedFromAccountId)
        : defaultFundingAccount;
      
      taxEvents.push({
        id: uuidv4(),
        year,
        type: 'incomeTax',
        description: income.accountName,
        sourceAccountId: income.accountId,
        sourceAccountName: income.accountName,
        assessableAmount: income.amount,
        fundedFromAccountId: fundingAccountId,
        fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
        personId: income.personId,
        personName: income.personName,
      });
    }

    // Generate tax events from events with taxTreatmentType
    // Note: Skip super contribution events as they're handled separately in the super contribution tax section
    // Also skip events that target income/expense accounts as those accounts already handle tax treatment
    for (const event of yearEvents) {
      if (event.type === 'superContribution') continue;
      
      // Skip events targeting income/expense accounts - they're already taxed via the account
      if (event.affectedAccountId) {
        const affectedAccount = accounts.find(a => a.id === event.affectedAccountId);
        if (affectedAccount && (affectedAccount.type === 'income' || affectedAccount.type === 'expense')) {
          continue;
        }
      }
      
      if (event.taxTreatmentType === 'taxable' && event.amount > 0) {
        const fundingAccountId = event.taxFundedFromAccountId ?? defaultFundingAccountId;
        const fundingAccount = event.taxFundedFromAccountId
          ? accounts.find(a => a.id === event.taxFundedFromAccountId)
          : defaultFundingAccount;
        
        // Use the event's explicit personId
        const eventPerson = event.personId ? persons.find(p => p.id === event.personId) : undefined;
        
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'incomeTax',
          description: event.description,
          assessableAmount: event.amount,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: event.personId,
          personName: eventPerson?.name,
        });
      } else if (event.taxTreatmentType === 'taxDeduction' && event.amount > 0) {
        const fundingAccountId = event.taxFundedFromAccountId ?? defaultFundingAccountId;
        const fundingAccount = event.taxFundedFromAccountId
          ? accounts.find(a => a.id === event.taxFundedFromAccountId)
          : defaultFundingAccount;
        
        // Use the event's explicit personId
        const eventPerson = event.personId ? persons.find(p => p.id === event.personId) : undefined;
        
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'taxDeduction',
          description: event.description,
          assessableAmount: -event.amount, // Negative to reduce taxable income
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: event.personId,
          personName: eventPerson?.name,
        });
      }
    }

    // Process CGT events with capital loss carry-forward
    // Step 1: Aggregate gains and losses per person for the year
    const cgtByPerson = new Map<string, { 
      grossGains: number; 
      grossLosses: number; 
      events: PendingCgtEvent[];
    }>();
    
    for (const cgtEvent of pendingCgtEvents) {
      const personId = cgtEvent.personId ?? 'unassigned';
      const existing = cgtByPerson.get(personId) ?? { grossGains: 0, grossLosses: 0, events: [] };
      
      if (cgtEvent.cgtResult.grossCapitalGain > 0) {
        existing.grossGains += cgtEvent.cgtResult.grossCapitalGain;
      } else {
        const loss = cgtEvent.cgtResult.costBase - cgtEvent.cgtResult.saleProceeds;
        if (loss > 0) {
          existing.grossLosses += loss;
        }
      }
      existing.events.push(cgtEvent);
      cgtByPerson.set(personId, existing);
    }
    
    // Step 2: For each person, apply losses to gains, then carry forward remaining
    for (const [personId, cgtData] of cgtByPerson) {
      const capitalLossState = capitalLossStates.get(personId) ?? { 
        personId, 
        openingBalance: 0,
        carryForwardBalance: 0 
      };
      // Opening balance was already set at start of year from prior carryForwardBalance
      const openingLossBalance = capitalLossState.openingBalance;
      
      // Total losses available = current year losses + carry-forward
      const totalLossesAvailable = cgtData.grossLosses + openingLossBalance;
      
      // Net position: gains minus total available losses (applied BEFORE discount)
      const netGainBeforeDiscount = Math.max(0, cgtData.grossGains - totalLossesAvailable);
      
      // Losses used this year
      const lossesUsed = Math.min(totalLossesAvailable, cgtData.grossGains);
      
      // Remaining losses to carry forward
      const newCarryForwardBalance = totalLossesAvailable - lossesUsed;
      capitalLossState.carryForwardBalance = newCarryForwardBalance;
      capitalLossStates.set(personId, capitalLossState);
      
      // Add capital loss events (for transparency)
      if (cgtData.grossLosses > 0) {
        for (const cgtEvent of cgtData.events) {
          const loss = cgtEvent.cgtResult.costBase - cgtEvent.cgtResult.saleProceeds;
          if (loss > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'capitalLoss',
              description: `Capital Loss: ${cgtEvent.accountName}`,
              sourceAccountId: cgtEvent.accountId,
              sourceAccountName: cgtEvent.accountName,
              assessableAmount: 0, // Losses don't directly affect assessable income
              fundedFromAccountId: cgtEvent.fundedFromAccountId,
              fundedFromAccountName: cgtEvent.fundedFromAccountName,
              personId: cgtEvent.personId,
              personName: cgtEvent.personName,
              costBase: cgtEvent.cgtResult.costBase,
              saleProceeds: cgtEvent.cgtResult.saleProceeds,
            });
          }
        }
      }
      
      // Add CGT events for gains (after applying losses)
      if (netGainBeforeDiscount > 0 && cgtData.grossGains > 0) {
        // Calculate proportion of each event's gain that survives after loss offset
        const gainSurvivalRatio = netGainBeforeDiscount / cgtData.grossGains;
        
        for (const cgtEvent of cgtData.events) {
          if (cgtEvent.cgtResult.grossCapitalGain > 0) {
            // Apply the survival ratio to get this event's share of net gain
            const eventNetGain = cgtEvent.cgtResult.grossCapitalGain * gainSurvivalRatio;
            
            // Apply CGT discount to the net gain (after losses applied)
            const discountedGain = cgtEvent.cgtResult.discountApplied 
              ? eventNetGain * 0.5 
              : eventNetGain;
            
            if (discountedGain > 0) {
              taxEvents.push({
                id: uuidv4(),
                year,
                type: 'capitalGainsTax',
                description: `CGT: ${cgtEvent.accountName}`,
                sourceAccountId: cgtEvent.accountId,
                sourceAccountName: cgtEvent.accountName,
                assessableAmount: discountedGain,
                fundedFromAccountId: cgtEvent.fundedFromAccountId,
                fundedFromAccountName: cgtEvent.fundedFromAccountName,
                personId: cgtEvent.personId,
                personName: cgtEvent.personName,
                grossCapitalGain: cgtEvent.cgtResult.grossCapitalGain,
                discountApplied: cgtEvent.cgtResult.discountApplied,
                costBase: cgtEvent.cgtResult.costBase,
                saleProceeds: cgtEvent.cgtResult.saleProceeds,
                capitalLossOffset: lossesUsed > 0 ? lossesUsed * (cgtEvent.cgtResult.grossCapitalGain / cgtData.grossGains) : undefined,
              });
            }
          }
        }
      }
    }

    // ===========================================
    // Super contribution tax processing
    // 1. 15% contributions tax (deducted from super account)
    // 2. Division 293 tax (for high-income earners)
    // ===========================================
    
    // Track super contribution processing results for tax calculations
    const superContributionResults: ContributionProcessingResult[] = [];
    
    if (settings.super && superContributionsByAccount.size > 0) {
      for (const [superAccountId, contribs] of superContributionsByAccount) {
        const superAccount = accounts.find(a => a.id === superAccountId);
        if (!superAccount) continue;
        
        const superResult = accountResults.get(superAccountId);
        if (!superResult) continue;
        
        // Get or initialize carry-forward state for this person
        const currentCarryForwardState = carryForwardStates.get(contribs.personId) ?? { 
          personId: contribs.personId, 
          unusedCaps: [] 
        };
        
        // Get or initialize non-concessional cap state for this person
        const currentNonConcCapState = nonConcessionalCapStates.get(contribs.personId) ?? {
          personId: contribs.personId,
          closingBalance: 0,
        };
        
        // Process contributions
        const result = processPersonContributions(
          contribs.personId,
          year,
          contribs.concessional,
          contribs.nonConcessional,
          currentCarryForwardState,
          currentNonConcCapState,
          settings.super
        );
        
        superContributionResults.push(result);
        
        // Deduct 15% contributions tax from super account (for concessional contributions within cap)
        if (result.contributionsTax > 0) {
          emitLedgerEntry(
            {
              accountId: superAccountId,
              amount: result.contributionsTax,
              delta: 'debit',
              kind: 'externalOut',
              label: 'Super contributions tax (15%)',
            },
            yearLedgerEntries,
            accountResults,
            accountValues,
            ledgerError,
          );
          
          // Add tax event for contributions tax
          const contribPerson = persons.find(p => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'superContributionTax',
            description: `Contributions Tax: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0, // Not assessable income - already taxed at source
            fundedFromAccountId: superAccountId, // Paid from super account
            fundedFromAccountName: superAccount.name,
            personId: contribs.personId,
            personName: contribPerson?.name,
          });
        }
        
        // Handle tax events for salary sacrifice and personal deductible contributions
        // These have DIFFERENT tax treatments:
        // - Salary sacrifice (pre-tax): Full amount reduces income, excess over cap is ADDED BACK
        // - Personal deductible (post-tax): Only amount within cap is deductible
        
        const contribPerson = persons.find(p => p.id === contribs.personId);
        const fundingAccountId = superAccount.taxFundedFromAccountId ?? settings.defaultTaxFundingAccountId ?? 'unassigned';
        const fundingAccount = accounts.find(a => a.id === fundingAccountId);
        const concessionalWithinCap = result.concessionalContributions - result.excessConcessional;
        
        // SALARY SACRIFICE (pre-tax): The full amount already reduced gross income
        // If there's excess over cap, we need to ADD IT BACK to assessable income
        if (contribs.preTaxReduction > 0) {
          // First, create a deduction for the full salary sacrifice amount
          // (This represents the income reduction that already happened at source)
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'taxDeduction',
            description: `Salary Sacrifice: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: -contribs.preTaxReduction,
            fundedFromAccountId: fundingAccountId,
            fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
            personId: contribs.personId,
            personName: contribPerson?.name,
          });
          
          // If pre-tax contributions exceed cap, add excess back to assessable income
          // (The excess wasn't really concessional - it must be taxed at marginal rate)
          const preTaxExcess = Math.max(0, contribs.preTaxReduction - concessionalWithinCap);
          if (preTaxExcess > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'incomeTax',
              description: `Excess Concessional (Salary Sacrifice): ${superAccount.name}`,
              sourceAccountId: superAccountId,
              sourceAccountName: superAccount.name,
              assessableAmount: preTaxExcess, // Add back to assessable income
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
        }
        
        // PERSONAL DEDUCTIBLE (post-tax): Only amount within cap is deductible
        if (contribs.postTaxDeduction > 0) {
          // Calculate how much of the post-tax contribution is deductible
          // It's limited to: (1) the available cap, and (2) the post-tax amount claimed
          // But we also need to account for any pre-tax contributions that used up the cap
          const capRemainingAfterPreTax = Math.max(0, concessionalWithinCap - contribs.preTaxReduction);
          const deductiblePostTax = Math.min(contribs.postTaxDeduction, capRemainingAfterPreTax);
          
          if (deductiblePostTax > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'taxDeduction',
              description: `Personal Deductible: ${superAccount.name}`,
              sourceAccountId: superAccountId,
              sourceAccountName: superAccount.name,
              assessableAmount: -deductiblePostTax, // Only the capped amount is deductible
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
          // Note: Excess post-tax contributions are NOT added back - they were already taxed
        }
        
        // Calculate Division 293 tax if applicable
        // Only concessional contributions WITHIN the cap are subject to Div 293
        // (excess concessional contributions are excluded per ATO rules)
        // Use the PERSON's income, not total income across all persons
        const personIncome = incomeByPerson.get(contribs.personId) ?? 0;
        const div293Result = calculateDiv293(
          personIncome, // Use this person's assessable income
          concessionalWithinCap,
          settings.super
        );
        
        if (div293Result.applies && div293Result.taxAmount > 0) {
          // Division 293 is paid from the default tax funding account (or super account)
          const div293FundingAccountId = superAccount.taxFundedFromAccountId ?? 
            settings.defaultTaxFundingAccountId ?? superAccountId;
          const div293FundingAccount = accounts.find(a => a.id === div293FundingAccountId) ?? superAccount;
          
          // Deduct from funding account
          emitLedgerEntry(
            {
              accountId: div293FundingAccountId,
              amount: div293Result.taxAmount,
              delta: 'debit',
              kind: 'externalOut',
              label: 'Division 293 tax',
            },
            yearLedgerEntries,
            accountResults,
            accountValues,
            ledgerError,
          );
          
          const div293Person = persons.find(p => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'division293Tax',
            description: `Div 293: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0, // Not assessable income
            fundedFromAccountId: div293FundingAccountId,
            fundedFromAccountName: div293FundingAccount.name,
            personId: contribs.personId,
            personName: div293Person?.name,
          });
        }
        
        // Note: Excess concessional contributions are NOT added back to assessable income
        // because we limit the deduction upfront to the available concessional cap.
        // The excess is treated as non-concessional for cap purposes (already handled above).
      }
    }

    // Aggregate tax by funding account
    const aggregationMap = new Map<string, { 
      fundedFromAccountName: string;
      taxSchedule: TaxSchedule;
      totalAssessable: number;
      events: TaxEvent[];
    }>();

    for (const taxEvent of taxEvents) {
      const existing = aggregationMap.get(taxEvent.fundedFromAccountId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
        existing.events.push(taxEvent);
      } else {
        const fundingAccount = accounts.find(a => a.id === taxEvent.fundedFromAccountId);
        const isSuperAccount = fundingAccount?.type === 'asset' && 
          fundingAccount.name?.toLowerCase().includes('super');
        
        aggregationMap.set(taxEvent.fundedFromAccountId, {
          fundedFromAccountName: taxEvent.fundedFromAccountName ?? 'Unknown',
          taxSchedule: isSuperAccount ? 'flatRate15' : 'marginalRates',
          totalAssessable: taxEvent.assessableAmount,
          events: [taxEvent],
        });
      }
    }

    const taxAggregations: TaxAggregation[] = [];
    let taxPayable = 0;

    for (const [fundedFromAccountId, agg] of aggregationMap) {
      let calculatedTax: number;
      if (agg.taxSchedule === 'marginalRates') {
        calculatedTax = calculateIncomeTax(agg.totalAssessable, year);
      } else {
        calculatedTax = agg.totalAssessable * 0.15;
      }

      taxAggregations.push({
        fundedFromAccountId,
        fundedFromAccountName: agg.fundedFromAccountName,
        taxSchedule: agg.taxSchedule,
        totalAssessable: agg.totalAssessable,
        calculatedTax,
      });

      taxPayable += calculatedTax;
    }
    
    // Apply franking credits as a tax offset (reduces tax payable, can result in refund)
    // Track per person for proper attribution
    const totalFrankingCredits = Array.from(frankingCreditsByPerson.values()).reduce((sum, v) => sum + v, 0);
    if (totalFrankingCredits > 0) {
      taxPayable -= totalFrankingCredits;
      // Note: taxPayable can go negative (refund scenario)
      
      // Create tax events per person
      for (const [personId, credits] of frankingCreditsByPerson) {
        const person = persons.find(p => p.id === personId);
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'frankingCreditOffset',
          description: person ? `Franking Credits (${person.name})` : 'Franking Credit Offset',
          assessableAmount: -credits, // Negative because it reduces tax
          fundedFromAccountId: 'unassigned',
          fundedFromAccountName: 'N/A',
          personId: personId !== 'unassigned' ? personId : undefined,
          personName: person?.name,
        });
      }
    }

    for (const [fundedFromAccountId, agg] of aggregationMap) {
      const calculatedTax = taxAggregations.find(a => a.fundedFromAccountId === fundedFromAccountId)?.calculatedTax ?? 0;
      
      // Deduct tax from funding account — money leaves model to ATO
      if (fundedFromAccountId !== 'unassigned') {
        emitLedgerEntry(
          {
            accountId: fundedFromAccountId,
            amount: calculatedTax,
            delta: 'debit',
            kind: 'externalOut',
            label: `Tax payment (${agg.taxSchedule === 'flatRate15' ? '15% flat' : 'marginal rates'})`,
          },
          yearLedgerEntries,
          accountResults,
          accountValues,
          ledgerError,
        );
      }
    }

    const netPosition = totalIncome - totalExpenses - taxPayable;

    // ===========================================
    // PHASE 8a: Minimum pension drawdown (allocated pensions)
    // Australian law requires minimum withdrawal based on age
    // ===========================================
    
    const superSettings = settings.super ?? defaultSettings.super;
    const drawdownRates = superSettings.minimumDrawdownRates ?? {
      under65: 0.04,
      '65-74': 0.05,
      '75-79': 0.06,
      '80-84': 0.07,
      '85-89': 0.09,
      '90-94': 0.11,
      '95plus': 0.14,
    };
    
    for (const account of accounts) {
      if (account.type !== 'asset' || account.assetSubType !== 'allocatedPension') continue;
      
      const result = accountResults.get(account.id);
      if (!result || result.endValue <= 0) continue;
      
      // Get the owner's age at 1 July of this year
      const owner = persons.find(p => p.id === account.owner);
      if (!owner) continue;
      
      const age = year - owner.birthYear;
      
      // Determine minimum drawdown rate based on age
      let minRate: number;
      if (age < 65) {
        minRate = drawdownRates.under65;
      } else if (age < 75) {
        minRate = drawdownRates['65-74'];
      } else if (age < 80) {
        minRate = drawdownRates['75-79'];
      } else if (age < 85) {
        minRate = drawdownRates['80-84'];
      } else if (age < 90) {
        minRate = drawdownRates['85-89'];
      } else if (age < 95) {
        minRate = drawdownRates['90-94'];
      } else {
        minRate = drawdownRates['95plus'];
      }
      
      const minimumDrawdown = result.endValue * minRate;
      
      // Check if actual withdrawals meet minimum
      const actualWithdrawals = result.withdrawals;
      
      if (actualWithdrawals < minimumDrawdown) {
        const shortfall = minimumDrawdown - actualWithdrawals;
        
        // Cap shortfall at available balance to prevent negative balance
        const actualShortfall = Math.min(shortfall, result.endValue);
        
        // Force additional withdrawal to meet minimum (capped to prevent negative)
        result.withdrawals += actualShortfall;
        result.endValue -= actualShortfall;
        accountValues.set(account.id, result.endValue);
        
        if (!result.cashflowDetails) result.cashflowDetails = [];
        result.cashflowDetails.push({
          description: `Minimum pension drawdown (age ${age}, ${minRate * 100}%)`,
          amount: shortfall,
          type: 'withdrawal',
        });
      }
    }

    // ===========================================
    // PHASE 8: Auto-topup processing
    // Runs AFTER liability payments and tax so balance reflects all withdrawals
    // Supports multiple source accounts with sequential drawdown
    // ===========================================
    
    for (const account of accounts) {
      if (account.type !== 'asset' || !account.autoTopup?.enabled) continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      const threshold = account.autoTopup.threshold ?? 0;
      
      // Check if balance is below threshold
      if (result.endValue < threshold) {
        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        let topupAmount = targetBalance - result.endValue;
        
        if (topupAmount <= 0) continue;

        // Get source accounts in priority order
        const sourceAccountIds = account.autoTopup.fromAccountIds ?? [];
        let remainingTopup = topupAmount;

        // Track contributions from multiple sources for the cashflow detail
        const topupContributions: { accountId: string; accountName: string; amount: number }[] = [];

        // Draw from each source account sequentially
        for (const sourceAccountId of sourceAccountIds) {
          if (remainingTopup <= 0) break;

          const sourceResult = accountResults.get(sourceAccountId);
          const sourceAccount = accounts.find(a => a.id === sourceAccountId);
          if (!sourceResult || !sourceAccount) continue;

          const availableBalance = sourceResult.endValue;
          let drawAmount: number;

          if (sourceAccountIds.length === 1) {
            drawAmount = remainingTopup;
          } else {
            drawAmount = Math.min(remainingTopup, availableBalance);
          }

          if (drawAmount > 0) {
            topupContributions.push({
              accountId: sourceAccountId,
              accountName: sourceAccount.name,
              amount: drawAmount,
            });

            emitLedgerEntry(
              {
                accountId: sourceAccountId,
                amount: drawAmount,
                delta: 'debit',
                kind: 'internalTransfer',
                label: `Auto top-up to: ${account.name}`,
                sourceAccountId: account.id,
                sourceAccountName: account.name,
              },
              yearLedgerEntries,
              accountResults,
              accountValues,
              ledgerError,
            );

            emitLedgerEntry(
              {
                accountId: account.id,
                amount: drawAmount,
                delta: 'credit',
                kind: 'internalTransfer',
                label: `Auto top-up from: ${sourceAccount.name}`,
                sourceAccountId: sourceAccountId,
                sourceAccountName: sourceAccount.name,
              },
              yearLedgerEntries,
              accountResults,
              accountValues,
              ledgerError,
            );

            result.autoTopupApplied = true;
            sourceResult.autoTopupApplied = true;

            remainingTopup -= drawAmount;
          }
        }
        }
      }
    }

    for (const account of accounts) {
      // Skip tax accounts - they get their results from createTaxAccountYearResults
      const category = account.category ?? 'standard';
      if (category !== 'standard') {
        continue;
      }
      const result = accountResults.get(account.id);
      if (result) {
        yearAccounts.push(result);
      }
    }

    let totalAssets = 0;
    let totalLiquidAssets = 0;
    let totalLiabilities = 0;
    for (const account of accounts) {
      // Skip accounts that don't contribute to net worth (tax cap/carry-forward accounts)
      if (account.includeInNetWorth === false) {
        continue;
      }
      const value = accountValues.get(account.id) ?? 0;
      if (account.type === 'asset') {
        totalAssets += value;
        if (account.liquidityType === 'liquid') {
          totalLiquidAssets += value;
        }
      } else if (account.type === 'liability') {
        totalLiabilities += value;
      }
    }

    if (totalAssets > peakAssets) {
      peakAssets = totalAssets;
      peakAssetsYear = year;
    }

    // ===========================================
    // Process super contributions and cap tracking
    // ===========================================
    const offBalanceSheet: OffBalanceSheetItem[] = [];
    
    if (persons.length > 0 && settings.super) {
      // Aggregate contributions by person for this year (cap-relevant only)
      const contributionsByPerson = aggregateContributionsByPerson(events, year, persons, accounts);
      
      // Process each person's contributions and update cap states
      const newCarryForwardStates = new Map<string, CarryForwardState>();
      const newNonConcessionalCapStates = new Map<string, NonConcessionalCapState>();
      const yearContributionResults: ContributionProcessingResult[] = [];
      
      for (const person of persons) {
        const personContribs = contributionsByPerson.get(person.id);
        const currentCarryForwardState = carryForwardStates.get(person.id) ?? { 
          personId: person.id, 
          unusedCaps: [] 
        };
        const currentNonConcCapState = nonConcessionalCapStates.get(person.id) ?? {
          personId: person.id,
          closingBalance: 0,
        };
        
        const result = processPersonContributions(
          person.id,
          year,
          personContribs?.concessional ?? 0,
          personContribs?.nonConcessional ?? 0,
          currentCarryForwardState,
          currentNonConcCapState,
          settings.super
        );
        
        newCarryForwardStates.set(person.id, result.newCarryForwardState);
        newNonConcessionalCapStates.set(person.id, result.newNonConcessionalCapState);
        yearContributionResults.push(result);
      }
      
      // Update states for next year
      carryForwardStates = newCarryForwardStates;
      nonConcessionalCapStates = newNonConcessionalCapStates;
      
      // Create off-balance sheet items for cap accounts (opening/movement/closing) - legacy
      const capAccountItems = createCapAccountOffBalanceSheetItems(
        yearContributionResults,
        persons,
        settings.super
      );
      offBalanceSheet.push(...capAccountItems);
      
      // Create AccountYearResult for tax accounts (new approach)
      const taxAccountResults = createTaxAccountYearResults(
        yearContributionResults,
        accounts,
        year
      );
      yearAccounts.push(...taxAccountResults);
    }
    
    // Add franking credits to off-balance sheet if any were generated (per person)
    for (const [personId, credits] of frankingCreditsByPerson) {
      if (credits > 0) {
        const person = persons.find(p => p.id === personId);
        offBalanceSheet.push({
          id: `franking-credits-${personId}`,
          type: 'frankingCredits',
          label: person ? `Franking Credits (${person.name})` : 'Franking Credits',
          personId: personId !== 'unassigned' ? personId : undefined,
          value: credits,
        });
        
        // Also create AccountYearResult for franking credits account
        const frankingResult = createFrankingCreditsYearResult(accounts, personId, credits, year);
        if (frankingResult) {
          yearAccounts.push(frankingResult);
        }
      }
    }
    
    // Add capital loss carry-forward to off-balance sheet
    for (const [personId, state] of capitalLossStates) {
      if (state.carryForwardBalance > 0 || state.openingBalance > 0) {
        const person = persons.find(p => p.id === personId);
        offBalanceSheet.push({
          id: `capital-loss-carry-forward-${personId}`,
          type: 'capitalLossCarryForward',
          label: person ? `Capital Loss Carry-Forward (${person.name})` : 'Capital Loss Carry-Forward',
          personId,
          opening: state.openingBalance,
          movement: state.carryForwardBalance - state.openingBalance,
          closing: state.carryForwardBalance,
        });
      }
    }

    // Calculate per-person tax aggregation
    const personTaxMap = new Map<string, { personName: string; totalAssessable: number }>();
    for (const taxEvent of taxEvents) {
      const personId = taxEvent.personId ?? 'unassigned';
      const personName = taxEvent.personName ?? 'Unassigned';
      const existing = personTaxMap.get(personId);
      if (existing) {
        existing.totalAssessable += taxEvent.assessableAmount;
      } else {
        personTaxMap.set(personId, {
          personName,
          totalAssessable: taxEvent.assessableAmount,
        });
      }
    }
    
    const taxByPerson: TaxByPerson[] = [];
    for (const [personId, data] of personTaxMap) {
      const calculatedTax = calculateIncomeTax(Math.max(0, data.totalAssessable), year);
      taxByPerson.push({
        personId,
        personName: data.personName,
        totalAssessable: data.totalAssessable,
        calculatedTax,
      });
    }

    // Conservation check — runs after all phases so all ledger entries are accumulated
    const conservation = checkConservation(yearLedgerEntries, accountResults, accounts, year);
    if (!conservation.passed) {
      yearWarnings.push({
        type: 'conservationViolation',
        severity: 'error',
        message: `Transaction integrity check failed for ${year}`,
        details: `Transfer imbalance: $${conservation.transferImbalance.toFixed(0)}. Wealth drift: $${conservation.wealthDrift.toFixed(0)}.`,
      });
    }

    years.push({
      year,
      accounts: yearAccounts,
      totalAssets,
      totalLiabilities,
      totalLiquidAssets,
      totalIncome,
      totalExpenses,
      taxPayable,
      taxEvents,
      taxAggregations,
      taxByPerson: taxByPerson.length > 0 ? taxByPerson : undefined,
      netPosition,
      resolvedAssumptions,
      offBalanceSheet: offBalanceSheet.length > 0 ? offBalanceSheet : undefined,
      warnings: yearWarnings.length > 0 ? yearWarnings : undefined,
    });
  }

  const finalAssets = years.length > 0 ? years[years.length - 1].totalAssets : 0;

  return {
    years,
    summary: {
      startYear,
      endYear,
      peakAssets,
      peakAssetsYear,
      finalAssets,
    },
  };
}

function resolveAssumptions(
  assumptions: Assumptions,
  year: number,
  epochs: Epoch[]
): ResolvedAssumptions {
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
  
  const getCpiForEpoch = (): number | undefined => {
    for (let i = sortedEpochs.length - 1; i >= 0; i--) {
      const epoch = sortedEpochs[i];
      if (year >= epoch.startYear && year <= epoch.endYear) {
        const override = epoch.globalAssumptions?.cpi;
        if (override !== undefined) return override;
        
        for (let j = i - 1; j >= 0; j--) {
          const prevOverride = sortedEpochs[j].globalAssumptions?.cpi;
          if (prevOverride !== undefined) return prevOverride;
        }
        break;
      }
    }
    return undefined;
  };

  const cpiOverride = getCpiForEpoch();
  const cpi = cpiOverride ?? resolveAssumptionForYear(assumptions.cpi, year);

  return { cpi };
}

function getAccountAssumptionForEpoch(
  account: Account,
  year: number,
  epochs: Epoch[],
  field: 'growthRate' | 'returnRate'
): number | undefined {
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);
  
  for (let i = sortedEpochs.length - 1; i >= 0; i--) {
    const epoch = sortedEpochs[i];
    if (year >= epoch.startYear && year <= epoch.endYear) {
      const override = epoch.accountAssumptions?.[account.id]?.[field];
      if (override !== undefined) return override;
      
      for (let j = i - 1; j >= 0; j--) {
        const prevOverride = sortedEpochs[j].accountAssumptions?.[account.id]?.[field];
        if (prevOverride !== undefined) return prevOverride;
      }
      break;
    }
  }
  return undefined;
}
