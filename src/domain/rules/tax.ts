/**
 * Pluggable tax rules.
 *
 * Each rule implements ITaxRule and can be registered in the RuleRegistry.
 * This makes Australian tax legislation data-driven: a new tax year, new offset,
 * or new rebate is a new rule class (or config), not a change to the forecast engine.
 */

import type { TaxRuleContext, TaxRuleResult, Money, Year, PersonId } from '../types';

// ============================================
// Tax bracket definition (data-driven)
// ============================================

export interface TaxBracket {
  min: Money;
  max: Money;
  rate: number; // decimal, e.g. 0.19
  baseTax: Money;
}

/**
 * Standard Australian marginal income tax brackets for a given year.
 */
export const TAX_BRACKETS_2024_25: TaxBracket[] = [
  { min: 0, max: 18200, rate: 0, baseTax: 0 },
  { min: 18201, max: 45000, rate: 0.19, baseTax: 0 },
  { min: 45001, max: 120000, rate: 0.325, baseTax: 5092 },
  { min: 120001, max: 190000, rate: 0.37, baseTax: 29467 },
  { min: 190001, max: Infinity, rate: 0.45, baseTax: 55367 },
];

// ============================================
// ITaxRule interface
// ============================================

export interface ITaxRule {
  readonly id: RuleId;
  readonly version: string; // e.g. "2024-25", "2025-26"
  readonly applicableYearRange: { start: Year; end: Year };
  readonly enabled: boolean;

  /**
   * Calculate tax for the given context.
   */
  calculate(ctx: TaxRuleContext): TaxRuleResult;

  /**
   * Optional: check if this rule applies to a given person/context without
   * running the full calculation.
   */
  isApplicable(ctx: TaxRuleContext): boolean;
}

// ============================================
// Marginal income tax rule (2024-25)
// ============================================

export class MarginalIncomeTaxRule implements ITaxRule {
  readonly id = 'marginal-income-tax';
  readonly version = '2024-25';
  readonly applicableYearRange = { start: 2024, end: 2025 };
  readonly enabled = true;

  constructor(private brackets: TaxBracket[] = TAX_BRACKETS_2024_25) {}

  isApplicable(ctx: TaxRuleContext): boolean {
    return ctx.year >= this.applicableYearRange.start && ctx.year <= this.applicableYearRange.end;
  }

  calculate(ctx: TaxRuleContext): TaxRuleResult {
    const income = ctx.assessableIncome;
    const events: TaxRuleResult['taxEvents'] = [];

    if (income <= 0) {
      return { taxPayable: 0, taxEvents: events };
    }

    let taxPayable = 0;

    for (const bracket of this.brackets) {
      if (income >= bracket.min && income <= bracket.max) {
        const taxableInBracket = income - bracket.min + 1;
        taxPayable = bracket.baseTax + taxableInBracket * bracket.rate;
        break;
      }
    }

    if (taxPayable === 0 && income > this.brackets[this.brackets.length - 1].min) {
      const topBracket = this.brackets[this.brackets.length - 1];
      const taxableInBracket = income - topBracket.min + 1;
      taxPayable = topBracket.baseTax + taxableInBracket * topBracket.rate;
    }

    events.push({
      type: 'incomeTax',
      description: `Income Tax (${this.version})`,
      assessableAmount: income,
      personId: ctx.personId,
      fundedFromAccountId: ctx.fundingAccountId,
      fundedFromAccountName: ctx.fundingAccountName,
      metadata: { ruleId: this.id, version: this.version },
    });

    return { taxPayable, taxEvents: events };
  }
}

// ============================================
// Capital gains tax rule
// ============================================

export interface CGTResult {
  grossCapitalGain: Money;
  discountApplied: boolean;
  discountedGain: Money;
  costBase: Money;
  saleProceeds: Money;
  taxPayable: Money;
}

export interface CGTRuleContext {
  saleProceeds: Money;
  costBase: Money;
  acquisitionYear: Year;
  saleYear: Year;
  eligibleForDiscount: boolean;
  personId: PersonId;
  marginalTaxRate: number; // effective marginal rate to apply to discounted gain
}

export interface ICGTRule {
  readonly id: RuleId;
  readonly version: string;
  readonly applicableYearRange: { start: Year; end: Year };
  readonly enabled: boolean;

  calculate(ctx: CGTRuleContext): CGTResult;
  isApplicable(ctx: CGTRuleContext): boolean;
}

export const CGT_DISCOUNT_PERCENTAGE = 0.5;
export const CGT_MIN_HOLDING_YEARS = 1;

/**
 * Standard Australian CGT rule with 50% discount for assets held > 1 year.
 */
export class StandardCGTRule implements ICGTRule {
  readonly id = 'capital-gains-tax';
  readonly version = '2024-25';
  readonly applicableYearRange = { start: 2024, end: 2025 };
  readonly enabled = true;

  isApplicable(ctx: CGTRuleContext): boolean {
    return ctx.saleYear >= this.applicableYearRange.start && ctx.saleYear <= this.applicableYearRange.end;
  }

  calculate(ctx: CGTRuleContext): CGTResult {
    const grossCapitalGain = Math.max(0, ctx.saleProceeds - ctx.costBase);
    const holdingYears = ctx.saleYear - ctx.acquisitionYear;
    const discountApplied = ctx.eligibleForDiscount && holdingYears >= CGT_MIN_HOLDING_YEARS && grossCapitalGain > 0;
    const discountedGain = discountApplied ? grossCapitalGain * (1 - CGT_DISCOUNT_PERCENTAGE) : grossCapitalGain;
    const taxPayable = discountedGain * ctx.marginalTaxRate;

    return {
      grossCapitalGain,
      discountApplied,
      discountedGain,
      costBase: ctx.costBase,
      saleProceeds: ctx.saleProceeds,
      taxPayable,
    };
  }
}

// ============================================
// Division 293 tax rule
// ============================================

export interface Div293Result {
  applies: boolean;
  taxAmount: Money;
  adjustedIncome: Money;
  threshold: Money;
  concessionalContributions: Money;
}

export interface Div293RuleContext {
  year: Year;
  taxableIncome: Money;
  concessionalContributions: Money;
  threshold: Money;
  rate: number;
}

export interface IDiv293Rule {
  readonly id: RuleId;
  readonly version: string;
  readonly applicableYearRange: { start: Year; end: Year };
  readonly enabled: boolean;

  calculate(ctx: Div293RuleContext): Div293Result;
  isApplicable(ctx: Div293RuleContext): boolean;
}

export class Division293Rule implements IDiv293Rule {
  readonly id = 'division-293';
  readonly version = '2024-25';
  readonly applicableYearRange = { start: 2024, end: 2025 };
  readonly enabled = true;

  constructor(private threshold: Money = 250000, private rate: number = 0.15) {}

  isApplicable(ctx: Div293RuleContext): boolean {
    return ctx.year !== undefined && ctx.year >= this.applicableYearRange.start && ctx.year <= this.applicableYearRange.end;
  }

  calculate(ctx: Div293RuleContext): Div293Result {
    const adjustedIncome = ctx.taxableIncome + ctx.concessionalContributions;
    const excess = Math.max(0, adjustedIncome - ctx.threshold);
    const taxBase = Math.min(excess, ctx.concessionalContributions);
    const taxAmount = taxBase * ctx.rate;

    return {
      applies: taxAmount > 0,
      taxAmount,
      adjustedIncome,
      threshold: ctx.threshold,
      concessionalContributions: ctx.concessionalContributions,
    };
  }
}
