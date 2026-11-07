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
} from '../schemas';

import type { RuleRegistry } from '../registry';
import type { AccountId, PersonId, Year, Money } from '../types';

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

  /** Mutable state accumulated during the pipeline run */
  readonly year: Year;
  readonly accountValues: Map<AccountId, Money>;
  readonly priorYearInflows: Map<AccountId, Money>;
  readonly accountStartYears: Map<AccountId, Year>;

  /** Super / cap state (carried across years) */
  readonly carryForwardStates: Map<PersonId, { personId: PersonId; unusedCaps: { year: Year; amount: Money }[] }>;
  readonly nonConcessionalCapStates: Map<PersonId, { personId: PersonId; closingBalance: Money }>;
  readonly capitalLossStates: Map<PersonId, { personId: PersonId; openingBalance: Money; carryForwardBalance: Money }>;

  /** Output - built up year by year */
  readonly results: YearResult[];
  readonly warnings: ForecastWarning[];

  /** Helpers */
  readonly peakAssets: Money;
  readonly peakAssetsYear: Year;
}

/**
 * A single stage in the forecast pipeline.
 */
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
  async runYear(context: ForecastContext): Promise<ForecastContext> {
    let ctx = context;
    for (const stage of this.getStages()) {
      if (!stage.enabled) continue;
      ctx = await stage.execute(ctx);
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
