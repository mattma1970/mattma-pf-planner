/**
 * Forecast pipeline stages.
 *
 * The forecast is decomposed into ordered stages. Each stage implements
 * IForecastStage and can be added, removed, or replaced without touching
 * other stages. This makes new features (e.g. aged care means testing,
 * pension drawdown minimums) a new stage registration.
 */

import type {
  Account,
  Event,
  Person,
  Settings,
  Epoch,
  Assumptions,
  ForecastResult,
  YearResult,
  AccountYearResult,
  ForecastWarning,
  TaxEvent,
  TaxAggregation,
  OffBalanceSheetItem,
  TaxByPerson,
} from '../schemas';
import type {
  ContributionProcessingResult,
} from '../../engine/superContributions';

import type { RuleRegistry } from '../registry';
import type {
  AccountId,
  PersonId,
  Year,
  Money,
  RuleId,
} from '../types';
import type { DoubleEntryTransaction } from '../../engine/ledger';

// ============================================
// Intermediate state types carried between stages
// ============================================

export interface LifecycleTransfer {
  sourceId: AccountId;
  destinationId: AccountId;
  amount: Money;
  endBehavior: 'transfer' | 'sell' | 'sellNoCgt';
  account: Account;
}

export interface PendingCgtEvent {
  accountId: AccountId;
  accountName: string;
  cgtResult: {
    grossCapitalGain: Money;
    discountApplied: boolean;
    discountedGain: Money;
    costBase: Money;
    saleProceeds: Money;
  };
  fundedFromAccountId: AccountId;
  fundedFromAccountName: string;
  personId?: PersonId;
  personName?: string;
}

export interface LiabilityPayoff {
  amount: Money;
  fundedByAccountId: AccountId;
  triggeredByAssetId: AccountId;
  triggeredByAssetName: string;
  liabilityName: string;
}

export interface SuperContributionFlow {
  accountId: AccountId;
  concessional: Money;
  nonConcessional: Money;
  preTaxReduction: Money;
  postTaxDeduction: Money;
  personId: PersonId;
}

export interface SuperContributionAccountResult {
  concessional: Money;
  nonConcessional: Money;
  preTaxReduction: Money;
  postTaxDeduction: Money;
  personId: PersonId;
}

export interface ContributionCapResultByPerson {
  unallowedNonConcessional: Money;
  totalRequestedNonConcessional: Money;
  excessConcessional: Money;
  blockedExcessConcessional: Money;
  totalRequestedConcessional: Money;
}

// ============================================
// Forecast context - flows through the pipeline
// ============================================

export interface ForecastContext {
  /** Configuration */
  readonly startYear: Year;
  readonly endYear: Year;
  readonly settings: Settings;
  readonly rules: RuleRegistry;

  /** Input data (read-only) */
  readonly accounts: Account[];
  readonly events: Event[];
  readonly persons: Person[];
  readonly epochs: Epoch[];
  readonly assumptions: Assumptions;

  /** Current year being processed */
  readonly year: Year;

  /** Mutable account state */
  readonly accountValues: Map<AccountId, Money>;
  readonly priorYearInflows: Map<AccountId, Money>;
  readonly accountStartYears: Map<AccountId, Year>;

  /** Current year account results (built during account processing) */
  readonly accountResults: Map<AccountId, AccountYearResult>;

  /** Opening values captured at start of current year */
  readonly openingValues?: Map<AccountId, Money>;

  /** Super / cap state (carried across years) */
  readonly carryForwardStates: Map<
    PersonId,
    { personId: PersonId; unusedCaps: { year: Year; amount: Money }[] }
  >;
  readonly nonConcessionalCapStates: Map<
    PersonId,
    { personId: PersonId; closingBalance: Money }
  >;
  readonly capitalLossStates: Map<
    PersonId,
    { personId: PersonId; openingBalance: Money; carryForwardBalance: Money }
  >;

  /** Lifecycle transfer state (set by LifecycleTransferStage) */
  readonly lifecycleTransfers?: LifecycleTransfer[];
  readonly lifecycleFlows?: Map<AccountId, Money>;
  readonly pendingCgtEvents?: PendingCgtEvent[];
  readonly liabilityPayoffs?: Map<AccountId, LiabilityPayoff>;

  /** User transfer state (set by UserTransferStage) */
  readonly userTransferFlows?: Map<AccountId, Money>;
  readonly superContributionFlows?: Map<AccountId, Money>;
  readonly superContributionsByAccount?: Map<AccountId, SuperContributionAccountResult>;
  readonly contributionCapResultsByPerson?: Map<PersonId, ContributionCapResultByPerson>;
  readonly contributionProcessingResults?: ContributionProcessingResult[];

  /** Output - built up year by year */
  readonly results: YearResult[];
  readonly warnings: ForecastWarning[];

  /** Per-year accumulators */
  readonly yearWarnings: ForecastWarning[];
  readonly yearLedgerEntries: Array<{
    accountId: AccountId;
    amount: Money;
    delta: 'credit' | 'debit';
    kind:
      | 'externalIn'
      | 'externalOut'
      | 'synthetic'
      | 'internalTransfer';
    label: string;
    sourceAccountId?: AccountId;
    sourceAccountName?: string;
  }>;
  readonly deferredLedgerEntries: DoubleEntryTransaction[];

  /** Per-year tax accumulators */
  readonly taxEvents: TaxEvent[];
  readonly incomeByAccount: Array<{
    accountId: AccountId;
    accountName: string;
    amount: Money;
    fundedFromAccountId?: AccountId;
    personId?: PersonId;
    personName?: string;
  }>;
  readonly incomeByPerson: Map<PersonId, Money>;
  readonly frankingCreditsByPerson: Map<PersonId, Money>;

  /** Year totals */
  readonly totalIncome: Money;
  readonly totalExpenses: Money;
  readonly taxPayable: Money;
  readonly netPosition: Money;

  /** Helpers */
  readonly peakAssets: Money;
  readonly peakAssetsYear: Year;

  /** Resolved assumptions for current year */
  readonly resolvedAssumptions: { cpi: Money };
}

// ============================================
// A single stage in the forecast pipeline
// ============================================

export interface IForecastStage {
  readonly id: string;
  readonly order: number;
  readonly enabled: boolean;

  /**
   * Execute this stage for the given year/context.
   * Returns a (possibly new) context with mutations applied.
   */
  execute(context: ForecastContext): ForecastContext | Promise<ForecastContext>;
}

// ============================================
// ForecastOrchestrator - runs stages in order
// ============================================

export class ForecastOrchestrator {
  private stages: IForecastStage[] = [];

  registerStage(stage: IForecastStage): void {
    this.stages.push(stage);
    this.stages.sort((a, b) => a.order - b.order);
  }

  unregisterStage(id: string): void {
    this.stages = this.stages.filter((s) => s.id !== id);
  }

  getStages(): IForecastStage[] {
    return [...this.stages].sort((a, b) => a.order - b.order);
  }

  /**
   * Run all registered stages for a single year.
   * Returns the mutated context.
   */
  runYear(context: ForecastContext): ForecastContext {
    let ctx = context;
    for (const stage of this.getStages()) {
      if (!stage.enabled) continue;
      const result = stage.execute(ctx);
      ctx = result instanceof Promise ? result : result;
      // If it's a promise, we need to await - but none of our stages are async
      // For safety, handle both sync and async
      if (result instanceof Promise) {
        throw new Error(`Async stage ${stage.id} not supported in sync runYear`);
      }
      ctx = result;
    }
    return ctx;
  }
}

// ============================================
// Built-in stage IDs (for ordering reference)
// ============================================

export const STAGE_IDS = {
  LIFECYCLE_TRANSFER: 'lifecycle-transfer',
  USER_TRANSFER: 'user-transfer',
  GROWTH: 'growth',
  DERIVED_FLOWS: 'derived-flows',
  LIABILITY: 'liability',
  TAX: 'tax',
  AUTO_TOPUP: 'auto-topup',
  CONSERVATION_CHECK: 'conservation-check',
} as const;
