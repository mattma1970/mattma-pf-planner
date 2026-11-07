/**
 * Pluggable superannuation rules.
 *
 * Caps, thresholds, and rates are encapsulated in rule implementations so that
 * legislative changes (e.g. concessional cap increases, new carry-forward rules)
 * are new rule classes, not edits to the forecast engine.
 */

import type { Money, Year, PersonId, SuperCapRuleResult, SuperCapRuleContext } from '../types';

// ============================================
// ISuperCapRule interface
// ============================================

export interface ISuperCapRule {
  readonly id: string;
  readonly version: string;
  readonly applicableYearRange: { start: Year; end: Year };
  readonly enabled: boolean;

  /**
   * Return the super caps and rates applicable for the given year/person.
   */
  calculate(ctx: SuperCapRuleContext): SuperCapRuleResult;

  isApplicable(ctx: SuperCapRuleContext): boolean;
}

// ============================================
// Standard 2024-25 super caps rule
// ============================================

export class StandardSuperCapRule implements ISuperCapRule {
  readonly id = 'super-caps-2024-25';
  readonly version = '2024-25';
  readonly applicableYearRange = { start: 2024, end: 2025 };
  readonly enabled = true;

  constructor(
    public concessionalCap: Money = 30000,
    public nonConcessionalCap: Money = 120000,
    public carryForwardYears: number = 5,
    public contributionsTaxRate: Money = 0.15,
    public employerSgRate: Money = 0.115,
    public preservationAge: number = 67,
    public div293Threshold: Money = 250000,
    public div293Rate: Money = 0.15
  ) {}

  isApplicable(ctx: SuperCapRuleContext): boolean {
    return ctx.year >= this.applicableYearRange.start && ctx.year <= this.applicableYearRange.end;
  }

  calculate(_ctx: SuperCapRuleContext): SuperCapRuleResult {
    return {
      concessionalCap: this.concessionalCap,
      nonConcessionalCap: this.nonConcessionalCap,
      carryForwardYears: this.carryForwardYears,
      contributionsTaxRate: this.contributionsTaxRate,
      employerSgRate: this.employerSgRate,
      preservationAge: this.preservationAge,
      div293Threshold: this.div293Threshold,
      div293Rate: this.div293Rate,
    };
  }
}

// ============================================
// Super contribution tax category
// ============================================

export const enum ContributionTaxCategory {
  Concessional = 'concessional',
  NonConcessional = 'nonConcessional',
}

export function getContributionTaxCategory(type: string): ContributionTaxCategory {
  if (type === 'concessional') return ContributionTaxCategory.Concessional;
  return ContributionTaxCategory.NonConcessional; // nonConcessional and capExempt
}

export function isCapExempt(type: string): boolean {
  return type === 'capExempt';
}

// ============================================
// Contribution processing result (shared with engine)
// ============================================

export interface CarryForwardState {
  personId: PersonId;
  unusedCaps: { year: Year; amount: Money }[];
}

export interface NonConcessionalCapState {
  personId: PersonId;
  closingBalance: Money;
}

export interface ContributionProcessingResult {
  personId: PersonId;
  year: Year;
  concessionalContributions: Money;
  nonConcessionalContributions: Money;
  concessionalCap: Money;
  availableCarryForward: Money;
  totalAvailableCap: Money;
  excessConcessional: Money;
  usedCarryForward: Money;
  remainingCarryForward: Money;
  nonConcessionalCapOpening: Money;
  nonConcessionalCapMovement: Money;
  nonConcessionalCapClosing: Money;
  blockedNonConcessional: Money;
  excessNonConcessional: Money;
  contributionsTax: Money;
  excessContributionsTax: Money;
  newCarryForwardState: CarryForwardState;
  newNonConcessionalCapState: NonConcessionalCapState;
}
