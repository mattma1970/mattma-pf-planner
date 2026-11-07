/**
 * Year-by-year forecasting engine.
 *
 * Refactored to use a pluggable pipeline architecture. The forecast is
 * decomposed into ordered stages (IForecastStage) executed by a
 * ForecastOrchestrator. This makes new features (e.g. aged care means
 * testing, pension drawdown minimums) and legislation changes (new tax
 * years, new super rules) pluggable without modifying the engine core.
 *
 * The public `calculateForecast` API is unchanged for backward compatibility.
 */

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
import {
  initializeCarryForwardStatesFromAccounts,
  initializeNonConcessionalCapStatesFromAccounts,
} from './superContributions';
import { defaultRuleRegistry } from '../domain/registry';
import {
  ForecastOrchestrator,
  STAGE_IDS,
} from '../domain/pipeline/stages';
import {
  LifecycleTransferStage,
} from '../domain/pipeline/stages/lifecycle-transfer';
import {
  UserTransferStage,
} from '../domain/pipeline/stages/user-transfer';
import {
  GrowthStage,
} from '../domain/pipeline/stages/growth';
import {
  DerivedFlowsStage,
} from '../domain/pipeline/stages/derived-flows';
import {
  LiabilityStage,
} from '../domain/pipeline/stages/liability';
import {
  TaxStage,
} from '../domain/pipeline/stages/tax';
import {
  AutoTopupStage,
} from '../domain/pipeline/stages/auto-topup';
import {
  ConservationCheckStage,
} from '../domain/pipeline/stages/conservation-check';
import type {
  ForecastContext,
  AccountId,
  Year,
  Money,
} from '../domain/types';

export interface ForecastInput {
  accounts: Account[];
  assumptions: Assumptions;
  epochs: Epoch[];
  events: Event[];
  persons: Person[];
  settings: Settings;
  startYear: Year;
  endYear: Year;
}

/**
 * Build the initial ForecastContext for a given year.
 */
function buildInitialContext(
  input: ForecastInput,
  year: Year,
  accountValues: Map<AccountId, Money>,
  priorYearInflows: Map<AccountId, Money>,
  accountStartYears: Map<AccountId, Year>,
  carryForwardStates: Map<string, { personId: string; unusedCaps: { year: number; amount: number }[] }>,
  nonConcessionalCapStates: Map<string, { personId: string; closingBalance: number }>,
  capitalLossStates: Map<string, { personId: string; openingBalance: number; carryForwardBalance: number }>,
  rules: typeof defaultRuleRegistry
): ForecastContext {
  const {
    accounts,
    assumptions,
    epochs,
    events,
    persons,
    settings,
    startYear,
    endYear,
  } = input;

  return {
    startYear,
    endYear,
    settings,
    rules,
    accounts,
    events,
    persons,
    epochs,
    assumptions,
    year,
    accountValues,
    priorYearInflows,
    accountStartYears,
    accountResults: new Map(),
    openingValues: new Map(),
    carryForwardStates,
    nonConcessionalCapStates,
    capitalLossStates,
    lifecycleTransfers: undefined,
    lifecycleFlows: undefined,
    pendingCgtEvents: undefined,
    liabilityPayoffs: undefined,
    userTransferFlows: undefined,
    superContributionFlows: undefined,
    superContributionsByAccount: undefined,
    contributionCapResultsByPerson: undefined,
    contributionProcessingResults: [],
    results: [],
    warnings: [],
    yearWarnings: [],
    yearLedgerEntries: [],
    deferredLedgerEntries: [],
    taxEvents: [],
    incomeByAccount: [],
    incomeByPerson: new Map(),
    frankingCreditsByPerson: new Map(),
    totalIncome: 0,
    totalExpenses: 0,
    taxPayable: 0,
    netPosition: 0,
    peakAssets: 0,
    peakAssetsYear: startYear,
    resolvedAssumptions: { cpi: 0 },
  } as unknown as ForecastContext;
}

/**
 * Build a YearResult from the forecast context after all stages have run.
 */
function buildYearResult(
  context: ForecastContext,
  accounts: Account[],
  persons: Person[],
  settings: Settings,
  year: Year,
  resolvedAssumptions: ResolvedAssumptions,
  mergedWarnings?: ForecastWarning[]
): YearResult {
  const {
    totalAssets,
    totalLiabilities,
    totalLiquidAssets,
    totalIncome,
    totalExpenses,
    taxPayable,
    taxEvents,
    taxAggregations,
    taxByPerson,
    netPosition,
    offBalanceSheet,
  } = extractYearTotals(context, accounts, persons, settings, year);

  return {
    year,
    accounts: Array.from(context.accountResults.values()),
    totalAssets,
    totalLiabilities,
    totalLiquidAssets,
    totalIncome,
    totalExpenses,
    taxPayable,
    taxEvents: taxEvents ?? [],
    taxAggregations: taxAggregations ?? [],
    taxByPerson: taxByPerson?.length > 0 ? taxByPerson : undefined,
    netPosition,
    resolvedAssumptions,
    offBalanceSheet: offBalanceSheet?.length > 0 ? offBalanceSheet : undefined,
    warnings: mergedWarnings?.length > 0 ? mergedWarnings : undefined,
  };
}

/**
 * Extract year-level totals from the context.
 */
function extractYearTotals(
  context: ForecastContext,
  accounts: Account[],
  persons: Person[],
  settings: Settings,
  year: Year
): {
  totalAssets: number;
  totalLiabilities: number;
  totalLiquidAssets: number;
  totalIncome: number;
  totalExpenses: number;
  taxPayable: number;
  taxEvents: TaxEvent[];
  taxAggregations: TaxAggregation[];
  taxByPerson: TaxByPerson[];
  netPosition: number;
  offBalanceSheet: OffBalanceSheetItem[];
  warnings: ForecastWarning[];
} {
  const {
    accountResults,
    accountValues,
    totalIncome,
    totalExpenses,
    taxPayable,
    netPosition,
    taxEvents = [],
    taxAggregations = [],
    taxByPerson = [],
    warnings = [],
    capitalLossStates = new Map(),
    frankingCreditsByPerson = new Map(),
  } = context;

  let totalAssets = 0;
  let totalLiquidAssets = 0;
  let totalLiabilities = 0;

  for (const account of accounts) {
    if (account.includeInNetWorth === false) continue;
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

  // Build off-balance sheet items
  const offBalanceSheet: OffBalanceSheetItem[] = [];

  // Capital loss carry-forward
  for (const [personId, state] of capitalLossStates) {
    if (state.carryForwardBalance > 0 || state.openingBalance > 0) {
      const person = persons.find((p) => p.id === personId);
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

  // Franking credits
  for (const [personId, credits] of frankingCreditsByPerson) {
    if (credits > 0) {
      const person = persons.find((p) => p.id === personId);
      offBalanceSheet.push({
        id: `franking-credits-${personId}`,
        type: 'frankingCredits',
        label: person ? `Franking Credits (${person.name})` : 'Franking Credits',
        personId: personId !== 'unassigned' ? personId : undefined,
        value: credits,
      });
    }
  }

  // Superannuation cap accounts from contribution processing results
  const personById = new Map(persons.map((p) => [p.id, p]));
  for (const result of context.contributionProcessingResults ?? []) {
    const person = personById.get(result.personId);
    if (!person) continue;

    // Concessional cap account
    const concessionalOpening = result.availableCarryForward + result.concessionalCap;
    const contributionsWithinCap = result.concessionalContributions - result.excessConcessional;
    const concessionalClosing = Math.max(0, concessionalOpening - result.concessionalContributions);

    offBalanceSheet.push({
      id: `conc-cap-${result.personId}-${year}`,
      type: 'concessionalCapAccount',
      label: `${person.name} - Concessional Cap`,
      personId: result.personId,
      opening: concessionalOpening,
      movement: -contributionsWithinCap,
      closing: concessionalClosing,
      value: concessionalClosing,
    });

    // Non-concessional cap account (bring-forward)
    offBalanceSheet.push({
      id: `nonconc-cap-${result.personId}-${year}`,
      type: 'nonConcessionalCapAccount',
      label: `${person.name} - Non-Concessional Cap`,
      personId: result.personId,
      opening: result.nonConcessionalCapOpening,
      movement: result.nonConcessionalCapMovement,
      closing: result.nonConcessionalCapClosing,
      value: result.nonConcessionalCapClosing,
    });
  }

  return {
    totalAssets,
    totalLiabilities,
    totalLiquidAssets,
    totalIncome,
    totalExpenses,
    taxPayable,
    taxEvents,
    taxAggregations: taxAggregations as TaxAggregation[],
    taxByPerson: taxByPerson as TaxByPerson[],
    netPosition,
    offBalanceSheet,
    warnings,
  };
}

export function calculateForecast(input: ForecastInput): ForecastResult {
  const {
    accounts,
    assumptions,
    epochs,
    events,
    persons,
    settings,
    startYear,
    endYear,
  } = input;

  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

  const years: YearResult[] = [];
  const accountValues: Map<AccountId, Money> = new Map();
  const accountStartYears: Map<AccountId, Year> = new Map();

  const priorYearInflows: Map<AccountId, Money> = new Map();

  accounts.forEach((account) => {
    accountValues.set(account.id, account.initialValue);
    if (account.type === 'income' || account.type === 'expense') {
      priorYearInflows.set(account.id, account.initialValue);
    }
  });

  let peakAssets = 0;
  let peakAssetsYear = startYear;

  let carryForwardStates = initializeCarryForwardStatesFromAccounts(
    persons,
    accounts,
    startYear,
    settings.super
  );
  let nonConcessionalCapStates = initializeNonConcessionalCapStatesFromAccounts(
    persons,
    accounts
  );

  let capitalLossStates = new Map<string, {
    personId: string;
    openingBalance: number;
    carryForwardBalance: number;
  }>();
  for (const person of persons) {
    capitalLossStates.set(person.id, {
      personId: person.id,
      openingBalance: 0,
      carryForwardBalance: 0,
    });
  }

  // Build the orchestrator with all stages
  const orchestrator = new ForecastOrchestrator();
  orchestrator.registerStage(new LifecycleTransferStage());
  orchestrator.registerStage(new UserTransferStage());
  orchestrator.registerStage(new GrowthStage());
  orchestrator.registerStage(new DerivedFlowsStage());
  orchestrator.registerStage(new LiabilityStage());
  orchestrator.registerStage(new TaxStage());
  orchestrator.registerStage(new AutoTopupStage());
  orchestrator.registerStage(new ConservationCheckStage());

  for (let year = startYear; year <= endYear; year++) {
    const context = buildInitialContext(
      input,
      year,
      accountValues,
      priorYearInflows,
      accountStartYears,
      carryForwardStates,
      nonConcessionalCapStates,
      capitalLossStates,
      defaultRuleRegistry
    );

    const resultContext = orchestrator.runYear(context);

    // Extract updated state from the result context
    carryForwardStates = resultContext.carryForwardStates;
    nonConcessionalCapStates = resultContext.nonConcessionalCapStates;
    capitalLossStates = resultContext.capitalLossStates;

    // Merge per-year warnings into the context warnings
    const mergedWarnings = [...(resultContext.warnings ?? []), ...(resultContext.yearWarnings ?? [])];

    // Update account values from the context
    for (const [accountId, value] of resultContext.accountValues) {
      accountValues.set(accountId, value);
    }

    // Build the year result
    const yearResult = buildYearResult(
      resultContext,
      accounts,
      persons,
      settings,
      year,
      resultContext.resolvedAssumptions,
      mergedWarnings
    );

    // Update peak assets
    if (yearResult.totalAssets > peakAssets) {
      peakAssets = yearResult.totalAssets;
      peakAssetsYear = year;
    }

    years.push(yearResult);
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
