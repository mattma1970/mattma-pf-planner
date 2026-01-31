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

interface PendingCgtEvent {
  accountId: string;
  accountName: string;
  cgtResult: CgtCalculationResult;
  fundedFromAccountId: string;
  fundedFromAccountName: string;
  personId?: string;
  personName?: string;
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
    
    // First pass: determine which accounts are ending and their transfer amounts
    const lifecycleTransfers: { 
      sourceId: string; 
      destinationId: string; 
      amount: number;
      endBehavior: 'transfer' | 'sell';
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

      // Handle CGT for sell behavior
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
        
        // Pay off any liabilities linked to this asset
        for (const liability of accounts) {
          if (liability.type === 'liability' && liability.payoffFromAccountId === account.id) {
            const liabilityBalance = accountValues.get(liability.id) ?? liability.initialValue;
            if (liabilityBalance > 0) {
              // Reduce the transfer proceeds by liability amount
              const payoffAmount = Math.min(liabilityBalance, transfer.amount);
              lifecycleFlows.set(
                transfer.destinationId,
                (lifecycleFlows.get(transfer.destinationId) ?? 0) - payoffAmount
              );
              // Mark liability as paid off
              lifecycleFlows.set(
                liability.id,
                (lifecycleFlows.get(liability.id) ?? 0) - liabilityBalance
              );
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
    
    const derivedFlows: { accountId: string; amount: number; type: 'contribution' | 'withdrawal'; description: string; sourceAccountId?: string; sourceAccountName?: string }[] = [];

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
          // For liabilities, just track the opening balance + any transfers
          // Interest will be calculated in the liability processing phase
          projectedValue = openingValue + lifecycleChange + userTransferChange;
          growth = 0;
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
          if (isFirstActiveYear) {
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

        endValue = projectedValue + eventContributions - eventWithdrawals;

        // PHASE 5: Derived flows
        if (account.type === 'income' && account.depositsToAccountId) {
          // All income accounts deposit projectedValue + contributions
          const totalIncomeToDeposit = projectedValue + contributions;
          if (totalIncomeToDeposit > 0) {
            derivedFlows.push({ accountId: account.depositsToAccountId, amount: totalIncomeToDeposit, type: 'contribution', description: `Income: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
          }
        }
        if (account.type === 'expense' && account.fundedByAccountId) {
          derivedFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal', description: `Expense: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
        if (account.type === 'asset' && account.incomeTargetAccountId && balanceForGrowth > 0) {
          const epochReturnOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'returnRate');
          const effectiveReturnRate = epochReturnOverride ?? account.returnRate;
          if (effectiveReturnRate) {
            const cashReturn = balanceForGrowth * effectiveReturnRate;
            
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
            
            // Deposit the grossed up amount to the income account (this becomes taxable income)
            derivedFlows.push({ accountId: account.incomeTargetAccountId, amount: grossedUpReturn, type: 'contribution', description: `Return: ${account.name}${frankingCredits > 0 ? ' (grossed up)' : ''}`, sourceAccountId: account.id, sourceAccountName: account.name });
          }
        }
        if (account.type === 'asset' && account.fundedByAccountId) {
          // Only fund actual cash contributions, NOT unrealized growth (appreciation)
          // Growth is paper value increase - no cash changes hands
          let fundingAmount = contributions - withdrawals;
          if (isFirstActiveYear) {
            fundingAmount += account.initialValue;
          }
          if (fundingAmount > 0) {
            derivedFlows.push({ accountId: account.fundedByAccountId, amount: fundingAmount, type: 'withdrawal', description: `Fund asset: ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
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
          derivedFlows.push({ accountId: account.depositsToAccountId, amount: projectedValue, type: 'contribution', description: `Income (held): ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
        if (account.type === 'expense' && account.fundedByAccountId && account.endBehavior === 'hold') {
          derivedFlows.push({ accountId: account.fundedByAccountId, amount: projectedValue, type: 'withdrawal', description: `Expense (held): ${account.name}`, sourceAccountId: account.id, sourceAccountName: account.name });
        }
      }

      accountValues.set(account.id, endValue);

      if (account.type === 'income') {
        // All income accounts: taxable income is projectedValue + contributions
        const taxableIncome = projectedValue + contributions;
        totalIncome += taxableIncome;
        // Track income per account for itemized tax events (skip tax-free income)
        if (taxableIncome > 0 && account.incomeTaxTreatment !== 'taxFree') {
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

    // Apply derived flows
    for (const flow of derivedFlows) {
      const result = accountResults.get(flow.accountId);
      if (result) {
        if (flow.type === 'contribution') {
          result.contributions += flow.amount;
          result.endValue += flow.amount;
        } else {
          result.withdrawals += flow.amount;
          result.endValue -= flow.amount;
        }
        accountValues.set(flow.accountId, result.endValue);
        
        // Track cashflow detail
        if (!result.cashflowDetails) {
          result.cashflowDetails = [];
        }
        result.cashflowDetails.push({
          description: flow.description,
          amount: flow.amount,
          type: flow.type,
          sourceAccountId: flow.sourceAccountId,
          sourceAccountName: flow.sourceAccountName,
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
      
      // Skip if liability is already paid off
      if (result.endValue <= 0) continue;
      
      const interestRate = account.interestRate ?? 0;
      
      // Calculate effective balance for interest (considering offset account)
      let effectiveBalance = result.endValue;
      if (account.offsetAccountId) {
        const offsetResult = accountResults.get(account.offsetAccountId);
        if (offsetResult) {
          effectiveBalance = Math.max(0, result.endValue - offsetResult.endValue);
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
      if (account.fundedByAccountId && paymentAmount > 0) {
        const fundingResult = accountResults.get(account.fundedByAccountId);
        if (fundingResult) {
          fundingResult.withdrawals += paymentAmount;
          fundingResult.endValue -= paymentAmount;
          accountValues.set(account.fundedByAccountId, fundingResult.endValue);
          
          // Track cashflow detail
          if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
          fundingResult.cashflowDetails.push({
            description: `Liability: ${account.name}`,
            amount: paymentAmount,
            type: 'withdrawal',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
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

    // Add CGT events
    for (const cgtEvent of pendingCgtEvents) {
      if (cgtEvent.cgtResult.discountedGain > 0) {
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'capitalGainsTax',
          description: `CGT: ${cgtEvent.accountName}`,
          sourceAccountId: cgtEvent.accountId,
          sourceAccountName: cgtEvent.accountName,
          assessableAmount: cgtEvent.cgtResult.discountedGain,
          fundedFromAccountId: cgtEvent.fundedFromAccountId,
          fundedFromAccountName: cgtEvent.fundedFromAccountName,
          personId: cgtEvent.personId,
          personName: cgtEvent.personName,
          grossCapitalGain: cgtEvent.cgtResult.grossCapitalGain,
          discountApplied: cgtEvent.cgtResult.discountApplied,
          costBase: cgtEvent.cgtResult.costBase,
          saleProceeds: cgtEvent.cgtResult.saleProceeds,
        });
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
          superResult.withdrawals += result.contributionsTax;
          superResult.endValue -= result.contributionsTax;
          accountValues.set(superAccountId, superResult.endValue);
          
          if (!superResult.cashflowDetails) superResult.cashflowDetails = [];
          superResult.cashflowDetails.push({
            description: `Super contributions tax (15%)`,
            amount: result.contributionsTax,
            type: 'withdrawal',
          });
          
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
          const fundingResult = accountResults.get(div293FundingAccountId);
          if (fundingResult) {
            fundingResult.withdrawals += div293Result.taxAmount;
            fundingResult.endValue -= div293Result.taxAmount;
            accountValues.set(div293FundingAccountId, fundingResult.endValue);
            
            if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
            fundingResult.cashflowDetails.push({
              description: `Division 293 tax`,
              amount: div293Result.taxAmount,
              type: 'withdrawal',
            });
          }
          
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
      
      // Deduct tax from funding account
      if (fundedFromAccountId !== 'unassigned') {
        const fundingResult = accountResults.get(fundedFromAccountId);
        if (fundingResult) {
          fundingResult.withdrawals += calculatedTax;
          fundingResult.endValue -= calculatedTax;
          accountValues.set(fundedFromAccountId, fundingResult.endValue);
          
          // Track cashflow detail
          if (!fundingResult.cashflowDetails) fundingResult.cashflowDetails = [];
          fundingResult.cashflowDetails.push({
            description: `Tax payment (${agg.taxSchedule === 'flatRate15' ? '15% flat' : 'marginal rates'})`,
            amount: calculatedTax,
            type: 'withdrawal',
          });
        }
      }
    }

    const netPosition = totalIncome - totalExpenses - taxPayable;

    // ===========================================
    // PHASE 8: Auto-topup processing
    // Runs AFTER liability payments and tax so balance reflects all withdrawals
    // ===========================================
    
    for (const account of accounts) {
      if (account.type !== 'asset' || !account.autoTopup?.enabled) continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      const threshold = account.autoTopup.threshold ?? 0;
      
      // Check if balance is below threshold
      if (result.endValue < threshold) {
        const sourceResult = accountResults.get(account.autoTopup.fromAccountId);
        if (!sourceResult) continue;
        
        // Calculate topup amount
        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        const topupAmount = targetBalance - result.endValue;
        
        if (topupAmount > 0) {
          const sourceAccount = accounts.find(a => a.id === account.autoTopup!.fromAccountId);
          
          // Apply topup to target account
          result.contributions += topupAmount;
          result.endValue += topupAmount;
          result.autoTopupApplied = true;
          accountValues.set(account.id, result.endValue);
          if (!result.cashflowDetails) result.cashflowDetails = [];
          result.cashflowDetails.push({
            description: `Auto top-up from: ${sourceAccount?.name ?? 'Unknown'}`,
            amount: topupAmount,
            type: 'contribution',
            sourceAccountId: account.autoTopup.fromAccountId,
            sourceAccountName: sourceAccount?.name,
          });
          
          // Withdraw from source account (allow negative balance)
          sourceResult.withdrawals += topupAmount;
          sourceResult.endValue -= topupAmount;
          sourceResult.autoTopupApplied = true;
          accountValues.set(account.autoTopup.fromAccountId, sourceResult.endValue);
          if (!sourceResult.cashflowDetails) sourceResult.cashflowDetails = [];
          sourceResult.cashflowDetails.push({
            description: `Auto top-up to: ${account.name}`,
            amount: topupAmount,
            type: 'withdrawal',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
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

    years.push({
      year,
      accounts: yearAccounts,
      totalAssets,
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
