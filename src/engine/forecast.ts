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
  type JournalEntry,
  type DeferredJournalEntry,
  type ConservationResult,
  EQUITY_ACCOUNT_ID,
  emitJournalEntry,
  applyDeferredJournalEntries,
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
    
    const incomeByAccount: { accountId: string; accountName: string; amount: number; fundedFromAccountId?: string; personId?: string; personName?: string }[] = [];
    const incomeByPerson = new Map<string, number>();
    const frankingCreditsByPerson = new Map<string, number>();

    // Update capital loss carry-forward opening balances
    for (const state of capitalLossStates.values()) {
      state.openingBalance = state.carryForwardBalance;
    }
    
    // Capture opening values for all accounts
    const openingValues = new Map<string, number>();
    for (const account of accounts) {
      const isFirstActiveYear = !accountStartYears.has(account.id) && isAccountActive(account, year, persons);
      let opening: number;
      if (isFirstActiveYear) {
        opening = account.initialValue;
      } else if (account.type === 'income' || account.type === 'expense') {
        opening = 0;
      } else if (accountStartYears.has(account.id)) {
        opening = accountValues.get(account.id) ?? 0;
      } else {
        opening = 0;
      }
      openingValues.set(account.id, opening);
    }
    
    const yearStartPriorInflows = new Map(priorYearInflows);
    
    // Check for incomplete employer SG accounts
    if (year === startYear) {
      for (const account of accounts) {
        if (
          account.type === 'income' &&
          account.basedOnAccountId &&
          account.basedOnPercentage !== undefined &&
          !account.superContributionConfig
        ) {
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
    
    // First pass: determine lifecycle transfers
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

      const openingValue = isFirstActiveYear
        ? account.initialValue
        : (account.type === 'income' || account.type === 'expense')
          ? 0
          : accountStartYears.has(account.id)
            ? (accountValues.get(account.id) ?? 0)
            : 0;

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
    
    // Track liability payoffs triggered by asset sales
    const liabilityPayoffs = new Map<string, { 
      amount: number; 
      fundedByAccountId: string;
      triggeredByAssetId: string;
      triggeredByAssetName: string;
      liabilityName: string;
    }>();
    
    for (const transfer of lifecycleTransfers) {
      if (transfer.endBehavior === 'sell' || transfer.endBehavior === 'sellNoCgt') {
        const account = transfer.account;
        for (const liability of accounts) {
          if (liability.type === 'liability' && liability.payoffFromAccountId === account.id) {
            const liabilityBalance = accountValues.get(liability.id) ?? liability.initialValue;
            if (liabilityBalance > 0 && liability.fundedByAccountId) {
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

    // Pre-initialize accountResults for all accounts
    accountResults.set(EQUITY_ACCOUNT_ID, {
      accountId: EQUITY_ACCOUNT_ID,
      year,
      startValue: 0,
      growth: 0,
      contributions: 0,
      withdrawals: 0,
      transfers: 0,
      endValue: 0,
    });
    accountValues.set(EQUITY_ACCOUNT_ID, 0);

    for (const account of accounts) {
      const isFirstActiveYear = accountStartYears.get(account.id) === year;
      let openingValue: number;
      if (account.type === 'income') {
        openingValue = 0;
      } else if (isFirstActiveYear) {
        // For assets funded by another account, the opening balance is 0
        // The value will be established by the fundedBy transfer entry
        if (account.type === 'asset' && account.fundedByAccountId) {
          openingValue = 0;
        } else {
          openingValue = account.initialValue;
        }
      } else if (accountStartYears.has(account.id)) {
        openingValue = accountValues.get(account.id) ?? 0;
      } else {
        openingValue = 0;
      }
      accountResults.set(account.id, {
        accountId: account.id,
        year,
        startValue: openingValue,
        growth: 0,
        contributions: 0,
        withdrawals: 0,
        transfers: 0,
        endValue: openingValue,
        cashflowDetails: [],
      });
    }

    const yearJournalEntries: JournalEntry[] = [];
    const deferredJournalEntries: DeferredJournalEntry[] = [];
    const userId = 'system';

    const ledgerError = (msg: string): void => {
      yearWarnings.push({ type: 'ledgerError', severity: 'error', message: msg });
    };

    const emit = (params: Parameters<typeof emitJournalEntry>[0]) =>
      emitJournalEntry(params, yearJournalEntries, accountResults, accountValues, accounts, year, userId, ledgerError);

    // ===========================================
    // PASS 1: Lifecycle transfers
    // ===========================================
    for (const transfer of lifecycleTransfers) {
      emit({
        debitAccountId: transfer.destinationId,
        creditAccountId: transfer.sourceId,
        amount: transfer.amount,
        label: `Lifecycle ${transfer.endBehavior}: ${transfer.account.name}`,
        kind: 'internalTransfer',
      });
      
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

    // ===========================================
    // PASS 2: User transfer events and super contributions
    // ===========================================
    
    // Track super contributions for this year
    const superContributionsByAccount = new Map<string, { 
      concessional: number; 
      nonConcessional: number; 
      preTaxReduction: number;
      postTaxDeduction: number;
      personId: string;
    }>();
    const superContributionDetails: { targetAccountId: string; description: string; amount: number; sourceAccountId?: string }[] = [];
    
    // Pre-calculate blocked/excess contributions per person
    const contributionCapResultsByPerson = new Map<string, {
      unallowedNonConcessional: number;
      totalRequestedNonConcessional: number;
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
        
        const totalUnallowed = result.blockedNonConcessional + result.excessNonConcessional;
        const totalForNonConcCap = (personContribs?.nonConcessional ?? 0) + result.excessConcessional;
        
        let unallowedNonConcessional = 0;
        let blockedExcessConcessional = 0;
        
        if (totalUnallowed > 0 && totalForNonConcCap > 0) {
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
        
        const totalBlocked = unallowedNonConcessional + blockedExcessConcessional;
        if (totalBlocked > 0) {
          const parts: string[] = [];
          if (unallowedNonConcessional > 0) {
            parts.push(`\$${Math.round(unallowedNonConcessional).toLocaleString()} non-concessional`);
          }
          if (blockedExcessConcessional > 0) {
            parts.push(`\$${Math.round(blockedExcessConcessional).toLocaleString()} excess concessional`);
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
        let transferAmount = event.amount;
        if (event.transferAll) {
          const sourceAccount = accounts.find(a => a.id === event.sourceAccountId);
          if (sourceAccount) {
            const result = accountResults.get(event.sourceAccountId);
            if (result) {
              transferAmount = result.endValue;
            }
          }
        }
        
        emit({
          debitAccountId: event.targetAccountId,
          creditAccountId: event.sourceAccountId,
          amount: transferAmount,
          label: event.description,
          kind: 'internalTransfer',
        });
      }
      
      if (event.type === 'superContribution' && event.superContribution && event.targetAccountId) {
        const { contributionType, memberPersonId, reducesAssessableIncome, source } = event.superContribution;
        const exemptFromCap = event.superContribution.exemptFromCap ?? isCapExempt(contributionType);
        
        const targetAccount = accounts.find(a => a.id === event.targetAccountId);
        const personId = targetAccount?.owner || memberPersonId;
        const taxCategory = getContributionTaxCategory(contributionType);
        
        let effectiveAmount = event.amount;
        
        if (!exemptFromCap && personId) {
          const capResult = contributionCapResultsByPerson.get(personId);
          
          if (capResult) {
            if (taxCategory === 'nonConcessional') {
              if (capResult.unallowedNonConcessional > 0 && capResult.totalRequestedNonConcessional > 0) {
                const unallowedRatio = capResult.unallowedNonConcessional / capResult.totalRequestedNonConcessional;
                const unallowedForThisEvent = event.amount * unallowedRatio;
                effectiveAmount = event.amount - unallowedForThisEvent;
              }
            } else if (taxCategory === 'concessional') {
              if (capResult.blockedExcessConcessional > 0 && capResult.totalRequestedConcessional > 0) {
                const blockedRatio = capResult.blockedExcessConcessional / capResult.totalRequestedConcessional;
                const blockedForThisEvent = event.amount * blockedRatio;
                effectiveAmount = event.amount - blockedForThisEvent;
              }
            }
          }
        }
        
        if (effectiveAmount > 0) {
          superContributionDetails.push({
            targetAccountId: event.targetAccountId,
            description: event.description,
            amount: effectiveAmount,
            sourceAccountId: event.sourceAccountId,
          });
          
          if (event.sourceAccountId) {
            emit({
              debitAccountId: event.targetAccountId,
              creditAccountId: event.sourceAccountId,
              amount: effectiveAmount,
              label: event.description,
              kind: 'internalTransfer',
            });
          } else {
            emit({
              debitAccountId: event.targetAccountId,
              creditAccountId: EQUITY_ACCOUNT_ID,
              amount: effectiveAmount,
              label: event.description,
              kind: 'externalIn',
            });
          }
        }
        
        const existing = superContributionsByAccount.get(event.targetAccountId) ?? { 
          concessional: 0, 
          nonConcessional: 0, 
          preTaxReduction: 0,
          postTaxDeduction: 0,
          personId: personId ?? 'unassigned'
        };
        if (taxCategory === 'concessional') {
          existing.concessional += event.amount;
          if (reducesAssessableIncome) {
            if (source === 'salarySacrifice') {
              existing.preTaxReduction += event.amount;
            } else {
              existing.postTaxDeduction += event.amount;
            }
          }
        } else {
          existing.nonConcessional += effectiveAmount;
        }
        superContributionsByAccount.set(event.targetAccountId, existing);
      }
    }
    
    // Process liability payoffs
    for (const [liabilityId, payoffInfo] of liabilityPayoffs) {
      emit({
        debitAccountId: liabilityId,
        creditAccountId: payoffInfo.fundedByAccountId,
        amount: payoffInfo.amount,
        label: `Payoff: ${payoffInfo.liabilityName}`,
        kind: 'internalTransfer',
        sourceAccountId: liabilityId,
        sourceAccountName: payoffInfo.liabilityName,
      });
    }

    // ===========================================
    // PASS 3: Events + income + expense
    // ===========================================
    for (const event of yearEvents) {
      if (event.type === 'transfer') continue;
      if (event.type === 'superContribution') continue;
      
      if (event.affectedAccountId) {
        if (event.type === 'income' || event.type === 'assetChange') {
          emit({
            debitAccountId: event.affectedAccountId,
            creditAccountId: EQUITY_ACCOUNT_ID,
            amount: event.amount,
            label: event.description,
            kind: 'externalIn',
            sourceAccountId: event.sourceAccountId,
          });
        } else if (event.type === 'expense' || event.type === 'liabilityChange') {
          emit({
            debitAccountId: EQUITY_ACCOUNT_ID,
            creditAccountId: event.affectedAccountId,
            amount: event.amount,
            label: event.description,
            kind: 'externalOut',
            sourceAccountId: event.sourceAccountId,
          });
        }
      }
    }
    
    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isFirstActiveYear = accountStartYears.get(account.id) === year;
      const isLifecycleEnding = lifecycleTransfers.some(t => t.sourceId === account.id);
      
      if (!isActive && !isLifecycleEnding) {
        if (account.type === 'income' && account.depositsToAccountId && account.endBehavior === 'hold') {
          const priorInflows = priorYearInflows.get(account.id) ?? account.initialValue;
          if (priorInflows > 0) {
            deferredJournalEntries.push({
              debitAccountId: account.depositsToAccountId,
              creditAccountId: EQUITY_ACCOUNT_ID,
              amount: priorInflows,
              label: `Income (held): ${account.name}`,
              kind: 'externalIn',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
        if (account.type === 'expense' && account.fundedByAccountId && account.endBehavior === 'hold') {
          const priorInflows = priorYearInflows.get(account.id) ?? account.initialValue;
          if (priorInflows > 0) {
            deferredJournalEntries.push({
              debitAccountId: EQUITY_ACCOUNT_ID,
              creditAccountId: account.fundedByAccountId,
              amount: priorInflows,
              label: `Expense (held): ${account.name}`,
              kind: 'externalOut',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
        continue;
      }
      
      if (account.type === 'income') {
        let projectedValue = 0;
        if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
          const refAccount = accounts.find(a => a.id === account.basedOnAccountId);
          if (refAccount && isAccountActive(refAccount, year, persons)) {
            let refValue = 0;
            if (refAccount.type === 'income') {
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
              refValue = openingValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
            }
            projectedValue = refValue * account.basedOnPercentage;
          }
        } else if (isFirstActiveYear) {
          projectedValue = account.initialValue;
        } else {
          const priorInflows = priorYearInflows.get(account.id) ?? account.initialValue;
          if (priorInflows > 0) {
            const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
            const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            projectedValue = projectAccountValue(account, year, priorInflows, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
          }
        }
        
        if (projectedValue > 0) {
          if (account.superContributionConfig && account.superContributionConfig.targetSuperAccountId) {
            const config = account.superContributionConfig;
            const targetSuperAccount = accounts.find(a => a.id === config.targetSuperAccountId);
            const personId = account.owner ?? targetSuperAccount?.owner;
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
              existing.concessional += projectedValue;
              if (config.reducesAssessableIncome) {
                if (config.source === 'salarySacrifice') {
                  existing.preTaxReduction += projectedValue;
                } else {
                  existing.postTaxDeduction += projectedValue;
                }
              }
            } else {
              existing.nonConcessional += projectedValue;
            }
            superContributionsByAccount.set(config.targetSuperAccountId, existing);
            
            deferredJournalEntries.push({
              debitAccountId: config.targetSuperAccountId,
              creditAccountId: EQUITY_ACCOUNT_ID,
              amount: projectedValue,
              label: `${config.source === 'employerSG' ? 'Employer SG' : config.source}: ${account.name}`,
              kind: 'externalIn',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          } else if (account.drawnFromAccountId && account.depositsToAccountId) {
            emit({
              debitAccountId: account.depositsToAccountId,
              creditAccountId: account.drawnFromAccountId,
              amount: projectedValue,
              label: `Drawdown: ${account.name}`,
              kind: 'internalTransfer',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          } else if (account.depositsToAccountId) {
            emit({
              debitAccountId: account.depositsToAccountId,
              creditAccountId: EQUITY_ACCOUNT_ID,
              amount: projectedValue,
              label: `Income: ${account.name}`,
              kind: 'externalIn',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
          
          const isDerivedSuperIncome = !!account.superContributionConfig;
          if (projectedValue > 0 && account.incomeTaxTreatment !== 'taxFree' && !isDerivedSuperIncome) {
            const ownerPerson = account.owner ? persons.find(p => p.id === account.owner) : undefined;
            incomeByAccount.push({
              accountId: account.id,
              accountName: account.name,
              amount: projectedValue,
              fundedFromAccountId: account.taxFundedFromAccountId,
              personId: account.owner,
              personName: ownerPerson?.name,
            });
            if (account.owner) {
              incomeByPerson.set(account.owner, (incomeByPerson.get(account.owner) ?? 0) + projectedValue);
            }
          }
          totalIncome += projectedValue;
          priorYearInflows.set(account.id, projectedValue);
        }
      } else if (account.type === 'expense') {
        const accountStartYear = accountStartYears.get(account.id) ?? year;
        const yearsSinceStart = year - accountStartYear + 1;
        
        const result = accountResults.get(account.id);
        const currentBalance = result?.endValue ?? 0;
        const balanceForGrowth = settings.growthCalculationMethod === 'averageBalance'
          ? currentBalance
          : currentBalance;
        
        let grownBaseValue: number;
        if (account.occursEveryYears) {
          const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
          let rate = 0;
          if (account.growthProfile.type === 'fixed') {
            rate = epochGrowthOverride ?? account.growthProfile.rate;
          } else if (account.growthProfile.type === 'cpiLinked') {
            const cpiValue = epochGrowthOverride ?? account.growthProfile.value ?? 0;
            rate = resolvedAssumptions.cpi + cpiValue;
          }
          grownBaseValue = account.initialValue * Math.pow(1 + rate, yearsSinceStart - 1);
        } else if (balanceForGrowth > 0) {
          const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
          grownBaseValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
        } else {
          grownBaseValue = balanceForGrowth;
        }
        
        const expenseResult = calculateExpenseValue(account, year, grownBaseValue, openingValues, accountStartYear, accounts, persons);
        
        if (account.fundedByAccountId && expenseResult.value > 0) {
          emit({
            debitAccountId: EQUITY_ACCOUNT_ID,
            creditAccountId: account.fundedByAccountId,
            amount: expenseResult.value,
            label: `Expense: ${account.name}`,
            kind: 'externalOut',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
        
        totalExpenses += expenseResult.value;
        priorYearInflows.set(account.id, expenseResult.value);
      } else if (account.type === 'asset' && account.fundedByAccountId && isFirstActiveYear && account.initialValue > 0) {
        emit({
          debitAccountId: account.id,
          creditAccountId: account.fundedByAccountId,
          amount: account.initialValue,
          label: `Fund asset: ${account.name}`,
          kind: 'internalTransfer',
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        });
      }
    }

    // ===========================================
    // PASS 4: Drawdowns (minimum pension drawdowns)
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
      
      const owner = persons.find(p => p.id === account.owner);
      if (!owner) continue;
      
      const age = year - owner.birthYear;
      
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
      
      const drawdownScale = account.drawdownScale ?? 1.0;
      const requiredDrawdown = result.endValue * minRate * drawdownScale;
      
      const actualWithdrawals = result.cashflowDetails
        ?.filter(d => d.type === 'withdrawal')
        .reduce((sum, d) => sum + d.amount, 0) ?? 0;
      
      if (actualWithdrawals < requiredDrawdown) {
        const shortfall = requiredDrawdown - actualWithdrawals;
        const actualShortfall = Math.min(shortfall, result.endValue);
        
        const drawdownTargetId = account.drawdownTargetAccountId ?? account.incomeTargetAccountId;
        
        emit({
          debitAccountId: EQUITY_ACCOUNT_ID,
          creditAccountId: account.id,
          amount: actualShortfall,
          label: `Pension drawdown (age ${age}, ${(minRate * drawdownScale * 100).toFixed(1)}%)`,
          kind: 'externalOut',
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        });
        
        if (drawdownTargetId) {
          emit({
            debitAccountId: drawdownTargetId,
            creditAccountId: EQUITY_ACCOUNT_ID,
            amount: actualShortfall,
            label: `Pension drawdown from: ${account.name}`,
            kind: 'externalIn',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      }
    }

    // ===========================================
    // PASS 5: Growth (asset appreciation, bank interest)
    // ===========================================
    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isLifecycleEnding = lifecycleTransfers.some(t => t.sourceId === account.id);
      
      if (!isActive || isLifecycleEnding) continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      if (account.type === 'asset') {
        const balanceBeforeGrowth = result.endValue;
        if (balanceBeforeGrowth <= 0 && result.startValue <= 0) continue;
        
        const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
        const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
        
        let balanceForGrowth: number;
        if (settings.growthCalculationMethod === 'averageBalance') {
          balanceForGrowth = (result.startValue + balanceBeforeGrowth) / 2;
        } else {
          balanceForGrowth = result.startValue;
        }
        
        if (balanceForGrowth <= 0) continue;
        
        const projectedValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
        const growthAmount = projectedValue - balanceForGrowth;
        
        if (growthAmount !== 0) {
          emit({
            debitAccountId: account.id,
            creditAccountId: EQUITY_ACCOUNT_ID,
            amount: growthAmount,
            label: `Growth: ${account.name}`,
            kind: 'growth',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
      } else if (account.type === 'liability') {
        const payoffInfo = liabilityPayoffs.get(account.id);
        if (payoffInfo) continue;
        
        if (result.endValue <= 0) continue;
        
        const interestRate = account.interestRate ?? 0;
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
        
        let effectiveBalance = balanceForInterest;
        if (account.offsetAccountId) {
          const offsetResult = accountResults.get(account.offsetAccountId);
          if (offsetResult) {
            const offsetBalance = Math.max(0, offsetResult.endValue);
            effectiveBalance = Math.max(0, balanceForInterest - offsetBalance);
          }
        }
        
        const interestAmount = effectiveBalance * interestRate;
        
        let paymentAmount = account.annualPayment ?? 0;
        
        if (account.calculatePayment && account.endCondition) {
          const owner = persons.find(p => p.id === account.owner);
          let endYear: number;
          if (account.endCondition.type === 'year') {
            endYear = account.endCondition.year;
          } else if (account.endCondition.type === 'age' && owner) {
            endYear = owner.birthYear + account.endCondition.age;
          } else {
            endYear = year + 30;
          }
          
          const yearsRemaining = Math.max(1, endYear - year + 1);
          
          if (interestRate > 0 && effectiveBalance > 0) {
            const principalToPay = result.endValue;
            const principalPaymentPerYear = principalToPay / yearsRemaining;
            paymentAmount = principalPaymentPerYear + interestAmount;
          } else if (interestRate > 0) {
            paymentAmount = result.endValue / yearsRemaining;
          } else {
            paymentAmount = result.endValue / yearsRemaining;
          }
        }
        
        if (account.paymentType === 'interestOnly') {
          paymentAmount = interestAmount;
        }
        
        const maxPayment = result.endValue + interestAmount;
        paymentAmount = Math.min(paymentAmount, maxPayment);
        
        const principalReduction = account.paymentType === 'interestOnly'
          ? 0
          : Math.max(0, paymentAmount - interestAmount);
        
        if (interestAmount !== 0) {
          emit({
            debitAccountId: EQUITY_ACCOUNT_ID,
            creditAccountId: account.id,
            amount: interestAmount,
            label: `Interest: ${account.name}`,
            kind: 'growth',
            sourceAccountId: account.id,
            sourceAccountName: account.name,
          });
        }
        
        if (account.fundedByAccountId && paymentAmount > 0) {
          if (interestAmount > 0) {
            emit({
              debitAccountId: EQUITY_ACCOUNT_ID,
              creditAccountId: account.fundedByAccountId,
              amount: interestAmount,
              label: `Interest: ${account.name}`,
              kind: 'externalOut',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
          if (principalReduction > 0) {
            emit({
              debitAccountId: account.id,
              creditAccountId: account.fundedByAccountId,
              amount: principalReduction,
              label: `Principal: ${account.name}`,
              kind: 'internalTransfer',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
          }
        }
      }
    }

    // ===========================================
    // PASS 6: Returns/dividends
    // ===========================================
    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      if (!isActive) continue;
      
      const result = accountResults.get(account.id);
      if (!result || result.endValue <= 0) continue;
      
      if (account.type === 'asset' && account.incomeTargetAccountId) {
        const epochReturnOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'returnRate');
        const effectiveReturnRate = epochReturnOverride ?? account.returnRate;
        if (!effectiveReturnRate) continue;
        
        const balanceMethod = account.returnBalanceMethod ?? 'average';
        const openingValue = result.startValue;
        const closingValue = result.endValue;
        let balanceForReturn: number;
        
        switch (balanceMethod) {
          case 'opening':
            balanceForReturn = openingValue;
            break;
          case 'closing':
            balanceForReturn = closingValue;
            break;
          case 'average':
          default:
            balanceForReturn = (openingValue + closingValue) / 2;
            break;
        }
        
        if (balanceForReturn <= 0) continue;
        
        const cashReturn = balanceForReturn * effectiveReturnRate;
        
        const frankingPercentage = account.frankingPercentage ?? 0;
        const companyTaxRate = settings.companyTaxRate ?? 0.30;
        
        let grossedUpReturn = cashReturn;
        let frankingCredits = 0;
        
        if (frankingPercentage > 0 && companyTaxRate > 0) {
          const frankedPortion = cashReturn * frankingPercentage;
          const unfrankedPortion = cashReturn - frankedPortion;
          const grossedUpFrankedPortion = frankedPortion / (1 - companyTaxRate);
          frankingCredits = grossedUpFrankedPortion - frankedPortion;
          grossedUpReturn = grossedUpFrankedPortion + unfrankedPortion;
          const ownerId = account.owner ?? 'unassigned';
          frankingCreditsByPerson.set(ownerId, (frankingCreditsByPerson.get(ownerId) ?? 0) + frankingCredits);
        }
        
        deferredJournalEntries.push({
          debitAccountId: account.incomeTargetAccountId,
          creditAccountId: EQUITY_ACCOUNT_ID,
          amount: grossedUpReturn,
          label: `Return: ${account.name}${frankingCredits > 0 ? ' (grossed up)' : ''}`,
          kind: 'synthetic',
          sourceAccountId: account.id,
          sourceAccountName: account.name,
        });
        
        const targetIncome = accounts.find((a) => a.id === account.incomeTargetAccountId);
        if (targetIncome && targetIncome.type !== 'income') {
          yearWarnings.push({
            type: 'other',
            severity: 'warning',
            message: `${account.name} targets ${targetIncome.name} (a ${targetIncome.type} account) for returns. Reconfigure it to target an income account.`,
            accountId: account.id,
          });
        }
      }
    }

    // ===========================================
    // PASS 7: Tax
    // ===========================================
    const taxEvents: TaxEvent[] = [];
    
    const defaultFundingAccountId = settings.defaultTaxFundingAccountId ?? 'unassigned';
    const defaultFundingAccount = settings.defaultTaxFundingAccountId 
      ? accounts.find(a => a.id === settings.defaultTaxFundingAccountId) 
      : undefined;
    
    // Tax events from income
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
    
    // Tax events from events
    for (const event of yearEvents) {
      if (event.type === 'superContribution') continue;
      
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
        
        const eventPerson = event.personId ? persons.find(p => p.id === event.personId) : undefined;
        
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'taxDeduction',
          description: event.description,
          assessableAmount: -event.amount,
          fundedFromAccountId: fundingAccountId,
          fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
          personId: event.personId,
          personName: eventPerson?.name,
        });
      }
    }
    
    // Process CGT events
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
    
    for (const [personId, cgtData] of cgtByPerson) {
      const capitalLossState = capitalLossStates.get(personId) ?? { 
        personId, 
        openingBalance: 0,
        carryForwardBalance: 0 
      };
      const openingLossBalance = capitalLossState.openingBalance;
      
      const totalLossesAvailable = cgtData.grossLosses + openingLossBalance;
      const netGainBeforeDiscount = Math.max(0, cgtData.grossGains - totalLossesAvailable);
      const lossesUsed = Math.min(totalLossesAvailable, cgtData.grossGains);
      const newCarryForwardBalance = totalLossesAvailable - lossesUsed;
      capitalLossState.carryForwardBalance = newCarryForwardBalance;
      capitalLossStates.set(personId, capitalLossState);
      
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
              assessableAmount: 0,
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
      
      if (netGainBeforeDiscount > 0 && cgtData.grossGains > 0) {
        const gainSurvivalRatio = netGainBeforeDiscount / cgtData.grossGains;
        
        for (const cgtEvent of cgtData.events) {
          if (cgtEvent.cgtResult.grossCapitalGain > 0) {
            const eventNetGain = cgtEvent.cgtResult.grossCapitalGain * gainSurvivalRatio;
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
    
    // Super contribution tax processing
    const superContributionResults: ContributionProcessingResult[] = [];
    
    if (settings.super && superContributionsByAccount.size > 0) {
      for (const [superAccountId, contribs] of superContributionsByAccount) {
        const superAccount = accounts.find(a => a.id === superAccountId);
        if (!superAccount) continue;
        
        const superResult = accountResults.get(superAccountId);
        if (!superResult) continue;
        
        const currentCarryForwardState = carryForwardStates.get(contribs.personId) ?? { 
          personId: contribs.personId, 
          unusedCaps: [] 
        };
        const currentNonConcCapState = nonConcessionalCapStates.get(contribs.personId) ?? {
          personId: contribs.personId,
          closingBalance: 0,
        };
        
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
        
        if (result.contributionsTax > 0) {
          emit({
            debitAccountId: EQUITY_ACCOUNT_ID,
            creditAccountId: superAccountId,
            amount: result.contributionsTax,
            label: 'Super contributions tax (15%)',
            kind: 'externalOut',
          });

          const contribPerson = persons.find(p => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'superContributionTax',
            description: `Contributions Tax: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0,
            fundedFromAccountId: superAccountId,
            fundedFromAccountName: superAccount.name,
            personId: contribs.personId,
            personName: contribPerson?.name,
          });
        }
        
        const contribPerson = persons.find(p => p.id === contribs.personId);
        const fundingAccountId = superAccount.taxFundedFromAccountId ?? settings.defaultTaxFundingAccountId ?? 'unassigned';
        const fundingAccount = accounts.find(a => a.id === fundingAccountId);
        const concessionalWithinCap = result.concessionalContributions - result.excessConcessional;
        
        if (contribs.preTaxReduction > 0) {
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
          
          const preTaxExcess = Math.max(0, contribs.preTaxReduction - concessionalWithinCap);
          if (preTaxExcess > 0) {
            taxEvents.push({
              id: uuidv4(),
              year,
              type: 'incomeTax',
              description: `Excess Concessional (Salary Sacrifice): ${superAccount.name}`,
              sourceAccountId: superAccountId,
              sourceAccountName: superAccount.name,
              assessableAmount: preTaxExcess,
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
        }
        
        if (contribs.postTaxDeduction > 0) {
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
              assessableAmount: -deductiblePostTax,
              fundedFromAccountId: fundingAccountId,
              fundedFromAccountName: fundingAccount?.name ?? 'Not configured',
              personId: contribs.personId,
              personName: contribPerson?.name,
            });
          }
        }
        
        const personIncome = incomeByPerson.get(contribs.personId) ?? 0;
        const div293Result = calculateDiv293(
          personIncome,
          concessionalWithinCap,
          settings.super
        );
        
        if (div293Result.applies && div293Result.taxAmount > 0) {
          const div293FundingAccountId = superAccount.taxFundedFromAccountId ?? 
            settings.defaultTaxFundingAccountId ?? superAccountId;
          const div293FundingAccount = accounts.find(a => a.id === div293FundingAccountId) ?? superAccount;
          
          emit({
            debitAccountId: EQUITY_ACCOUNT_ID,
            creditAccountId: div293FundingAccountId,
            amount: div293Result.taxAmount,
            label: 'Division 293 tax',
            kind: 'externalOut',
          });

          const div293Person = persons.find(p => p.id === contribs.personId);
          taxEvents.push({
            id: uuidv4(),
            year,
            type: 'division293Tax',
            description: `Div 293: ${superAccount.name}`,
            sourceAccountId: superAccountId,
            sourceAccountName: superAccount.name,
            assessableAmount: 0,
            fundedFromAccountId: div293FundingAccountId,
            fundedFromAccountName: div293FundingAccount.name,
            personId: contribs.personId,
            personName: div293Person?.name,
          });
        }
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
    
    const totalFrankingCredits = Array.from(frankingCreditsByPerson.values()).reduce((sum, v) => sum + v, 0);
    if (totalFrankingCredits > 0) {
      taxPayable -= totalFrankingCredits;
      
      for (const [personId, credits] of frankingCreditsByPerson) {
        const person = persons.find(p => p.id === personId);
        taxEvents.push({
          id: uuidv4(),
          year,
          type: 'frankingCreditOffset',
          description: person ? `Franking Credits (${person.name})` : 'Franking Credit Offset',
          assessableAmount: -credits,
          fundedFromAccountId: 'unassigned',
          fundedFromAccountName: 'N/A',
          personId: personId !== 'unassigned' ? personId : undefined,
          personName: person?.name,
        });
      }
    }
    
    for (const [fundedFromAccountId] of aggregationMap) {
      const calculatedTax = taxAggregations.find(a => a.fundedFromAccountId === fundedFromAccountId)?.calculatedTax ?? 0;
      
      if (fundedFromAccountId !== 'unassigned') {
        emit({
          debitAccountId: EQUITY_ACCOUNT_ID,
          creditAccountId: fundedFromAccountId,
          amount: calculatedTax,
          label: `Tax payment (${year})`,
          kind: 'externalOut',
        });
      }
    }
    
    // Handle tax on synthetic returns (deferred entries)
    for (const entry of deferredJournalEntries) {
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
    
    const netPosition = totalIncome - totalExpenses - taxPayable;

    // ===========================================
    // PASS 8: Auto-topup
    // ===========================================
    for (const account of accounts) {
      if (account.type !== 'asset' || !account.autoTopup?.enabled) continue;
      
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      const threshold = account.autoTopup.threshold ?? 0;
      
      if (result.endValue < threshold) {
        const targetBalance = account.autoTopup.targetBalance ?? threshold;
        let topupAmount = targetBalance - result.endValue;
        
        if (topupAmount <= 0) continue;
        
        const sourceAccountIds = account.autoTopup.fromAccountIds ?? [];
        let remainingTopup = topupAmount;
        
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
            emit({
              debitAccountId: account.id,
              creditAccountId: sourceAccountId,
              amount: drawAmount,
              label: `Auto top-up to: ${account.name}`,
              kind: 'internalTransfer',
              sourceAccountId: account.id,
              sourceAccountName: account.name,
            });
            
            result.autoTopupApplied = true;
            sourceResult.autoTopupApplied = true;
            
            remainingTopup -= drawAmount;
          }
        }
      }
    }

    // Set endValue for income/expense accounts and handle inactive accounts
    for (const account of accounts) {
      const isActive = isAccountActive(account, year, persons);
      const isLifecycleEnding = lifecycleTransfers.some(t => t.sourceId === account.id);
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      if (account.type === 'income') {
        // For income accounts, endValue = total income for the year
        // If not active, apply endBehavior
        if (!isActive && !isLifecycleEnding) {
          if (account.endBehavior === 'zero') {
            result.endValue = 0;
          } else if (account.endBehavior === 'hold') {
            const heldValue = priorYearInflows.get(account.id) ?? account.initialValue;
            result.endValue = heldValue;
            totalIncome += heldValue;
          } else {
            result.endValue = 0;
          }
        } else {
          // Calculate income value
          let projectedValue = 0;
          if (account.basedOnAccountId && account.basedOnPercentage !== undefined) {
            const refAccount = accounts.find(a => a.id === account.basedOnAccountId);
            if (refAccount && isAccountActive(refAccount, year, persons)) {
              let refValue = 0;
              if (refAccount.type === 'income') {
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
                refValue = openingValues.get(account.basedOnAccountId) ?? refAccount.initialValue;
              }
              projectedValue = refValue * account.basedOnPercentage;
            }
          } else if (accountStartYears.get(account.id) === year) {
            projectedValue = account.initialValue;
          } else {
            const priorInflows = yearStartPriorInflows.get(account.id) ?? account.initialValue;
            if (priorInflows > 0) {
              const yearsSinceStart = year - (accountStartYears.get(account.id) ?? year) + 1;
              const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
              projectedValue = projectAccountValue(account, year, priorInflows, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
            }
          }
          result.endValue = projectedValue + result.endValue;
          totalIncome += projectedValue;
          priorYearInflows.set(account.id, projectedValue);
        }
      } else if (account.type === 'expense') {
        if (!isActive && !isLifecycleEnding) {
          if (account.endBehavior === 'zero') {
            result.endValue = 0;
          } else if (account.endBehavior === 'hold') {
            const heldValue = priorYearInflows.get(account.id) ?? account.initialValue;
            result.endValue = heldValue;
            totalExpenses += heldValue;
          } else {
            result.endValue = 0;
          }
        } else {
          const accountStartYear = accountStartYears.get(account.id) ?? year;
          const yearsSinceStart = year - accountStartYear + 1;
          const currentBalance = result.endValue;
          const balanceForGrowth = settings.growthCalculationMethod === 'averageBalance'
            ? currentBalance
            : currentBalance;
          
          let grownBaseValue: number;
          if (account.occursEveryYears) {
            const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            let rate = 0;
            if (account.growthProfile.type === 'fixed') {
              rate = epochGrowthOverride ?? account.growthProfile.rate;
            } else if (account.growthProfile.type === 'cpiLinked') {
              const cpiValue = epochGrowthOverride ?? account.growthProfile.value ?? 0;
              rate = resolvedAssumptions.cpi + cpiValue;
            }
            grownBaseValue = account.initialValue * Math.pow(1 + rate, yearsSinceStart - 1);
          } else if (balanceForGrowth > 0) {
            const epochGrowthOverride = getAccountAssumptionForEpoch(account, year, sortedEpochs, 'growthRate');
            grownBaseValue = projectAccountValue(account, year, balanceForGrowth, resolvedAssumptions, yearsSinceStart, epochGrowthOverride);
          } else {
            grownBaseValue = balanceForGrowth;
          }
          
          const expenseResult = calculateExpenseValue(account, year, grownBaseValue, openingValues, accountStartYear, accounts, persons);
          result.endValue = expenseResult.value;
          totalExpenses += expenseResult.value;
          priorYearInflows.set(account.id, expenseResult.value);
        }
      } else if (!isActive && !isLifecycleEnding) {
        // For inactive assets/liabilities, apply endBehavior
        if (account.endBehavior === 'zero') {
          result.endValue = 0;
        } else if (account.endBehavior === 'hold') {
          // Keep current balance
        } else if (account.endBehavior === 'transfer' || account.endBehavior === 'sell') {
          // Keep current balance
        } else {
          result.endValue = 0;
        }
      }
    }

    // Apply deferred entries
    applyDeferredJournalEntries(deferredJournalEntries, yearJournalEntries, accountResults, accountValues, accounts, year, userId, ledgerError);
    
    // Forward income-account credits to their depositsToAccountId
    for (const entry of yearJournalEntries) {
      const targetAccount = accounts.find((a) => a.id === entry.debitAccountId);
      if (!targetAccount || targetAccount.type !== 'income') continue;
      if (!targetAccount.depositsToAccountId) continue;
      
      emit({
        debitAccountId: targetAccount.depositsToAccountId,
        creditAccountId: EQUITY_ACCOUNT_ID,
        amount: entry.amount,
        label: `Via ${targetAccount.name}: ${entry.label}`,
        kind: 'externalIn',
        sourceAccountId: entry.sourceAccountId,
        sourceAccountName: entry.sourceAccountName,
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
    
    // Final pass: set accountValues
    for (const account of accounts) {
      const result = accountResults.get(account.id);
      if (result) {
        accountValues.set(account.id, result.endValue);
      }
    }
    
    // Account reconciliation
    for (const account of accounts) {
      const result = accountResults.get(account.id);
      if (!result) continue;
      
      if (account.type !== 'income' && account.type !== 'expense') {
        const transferSign = account.type === 'liability' ? -1 : 1;
        const expectedEndValue = result.startValue + result.growth + result.contributions - result.withdrawals + (transferSign * result.transfers);
        const discrepancy = Math.abs(result.endValue - expectedEndValue);
        if (discrepancy > 1) {
          yearWarnings.push({
            type: 'other',
            severity: 'error',
            message: `${account.name} (${year}) reconciliation failed: expected \$${expectedEndValue.toLocaleString()}, got \$${result.endValue.toLocaleString()}`,
            details: `Discrepancy: \$${discrepancy.toLocaleString()}. This means a flow was recorded incorrectly or is missing from the accounting totals.`,
            accountId: account.id,
            amount: discrepancy,
          });
        }
      }
      
      if (account.type === 'asset' && account.fundedByAccountId && accountStartYears.get(account.id) === year) {
        const fundingResult = accountResults.get(account.fundedByAccountId);
        if (fundingResult) {
          const fundedByEntries = (fundingResult.cashflowDetails ?? []).filter(
            (d) => d.sourceAccountId === account.id && d.description.startsWith('Fund asset:'),
          );
          if (fundedByEntries.length === 0) {
            yearWarnings.push({
              type: 'other',
              severity: 'error',
              message: `${account.name} is funded by ${fundingResult.startValue > 0 ? 'an account' : 'another account'}, but no funding transaction was recorded in ${year}.`,
              details: `Expected a 'Fund asset: ${account.name}' entry in the funding account's transactions. The \$${account.initialValue.toLocaleString()} purchase may not have been deducted from the funding account.`,
              accountId: account.id,
              amount: account.initialValue,
            });
          }
        }
      }
    }
    
    // Build yearAccounts
    for (const account of accounts) {
      const category = account.category ?? 'standard';
      if (category !== 'standard') {
        continue;
      }
      const result = accountResults.get(account.id);
      if (result) {
        yearAccounts.push(result);
      }
    }
    
    // Calculate totals
    let totalAssets = 0;
    let totalLiquidAssets = 0;
    let totalLiabilities = 0;
    for (const account of accounts) {
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
    
    // Super contributions and cap tracking
    const offBalanceSheet: OffBalanceSheetItem[] = [];
    
    if (persons.length > 0 && settings.super) {
      const contributionsByPerson = aggregateContributionsByPerson(events, year, persons, accounts);
      
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
      
      carryForwardStates = newCarryForwardStates;
      nonConcessionalCapStates = newNonConcessionalCapStates;
      
      const capAccountItems = createCapAccountOffBalanceSheetItems(
        yearContributionResults,
        persons,
        settings.super
      );
      offBalanceSheet.push(...capAccountItems);
      
      const taxAccountResults = createTaxAccountYearResults(
        yearContributionResults,
        accounts,
        year
      );
      yearAccounts.push(...taxAccountResults);
    }
    
    // Add franking credits
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
        
        const frankingResult = createFrankingCreditsYearResult(accounts, personId, credits, year);
        if (frankingResult) {
          yearAccounts.push(frankingResult);
        }
      }
    }
    
    // Add capital loss carry-forward
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
    
    // Calculate per-person tax
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
    
    const conservation = checkConservation(yearJournalEntries, accountResults, accounts, year);
    const accountNames = new Map(accounts.map(a => [a.id, a.name]));
    const conservationLog = formatConservationLog(conservation, accountNames);
    if (!conservation.passed) {
      yearWarnings.push({
        type: 'conservationViolation',
        severity: 'error',
        message: `Transaction integrity check failed for ${year}`,
        details: `Transfer imbalance: \$${conservation.transferImbalance.toFixed(0)}. Wealth drift: \$${conservation.wealthDrift.toFixed(0)}.`,
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
      journal: yearJournalEntries,
      conservationLog,
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

function formatConservationLog(
  conservation: ConservationResult,
  accountNames: Map<string, string>,
): string {
  const lines: string[] = [];
  const y = conservation.year;
  const d = conservation.details;
  const status = conservation.passed ? 'PASSED' : 'FAILED';
  const pad = (n: number) => n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`;

  lines.push(`=== Conservation Check - Year ${y} ===`);
  lines.push(`Status: ${status}`);
  lines.push(`Transfer Imbalance: ${pad(conservation.transferImbalance)}`);
  lines.push(`Wealth Drift: ${pad(conservation.wealthDrift)}`);
  lines.push('');
  lines.push(`Net Wealth: opening=${pad(d.openingNetWealth)}  closing=${pad(d.closingNetWealth)}  actualDelta=${pad(d.actualDelta)}`);
  lines.push(`Expected: assetGrowth=${pad(d.assetGrowth)}  externalIn=${pad(d.externalIn)}  externalOut=${pad(d.externalOut)}  synthetic=${pad(d.synthetic)}  liabilityChange=${pad(d.liabilityChange)}  total=${pad(d.expectedDelta)}`);
  lines.push('');
  lines.push('Journal Entries:');
  for (const entry of conservation.entries) {
    const debitName = accountNames.get(entry.debitAccountId) ?? entry.debitAccountId;
    const creditName = accountNames.get(entry.creditAccountId) ?? entry.creditAccountId;
    const amt = pad(entry.amount).padStart(12);
    const kind = (entry.kind ?? 'unknown').padEnd(16);
    lines.push(`  Dr ${amt}  ${debitName}  ${kind}  ${entry.label}`);
    lines.push(`  Cr ${amt}  ${creditName}  ${kind}  ${entry.label}`);
  }
  lines.push('');

  return lines.join('\n');
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
