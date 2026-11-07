/**
 * RuleRegistry - the plugin container for legislation and business rules.
 *
 * Rules are registered by type (tax, super, account behavior, event handler,
 * forecast stage). The registry resolves the applicable rules for a given
 * year/context, so the forecast engine never hardcodes legislation.
 *
 * Rules are stored as flat arrays per type. Each rule is standalone;
 * registering a new rule does not remove existing rules with the same id,
 * which allows multiple year-specific versions of the same rule to coexist
 * (e.g. "marginal-income-tax-2024-25" and "marginal-income-tax-2025-26").
 */

import type {
  ITaxRule,
  ICGTRule,
  IDiv293Rule,
  ISuperCapRule as ISuperCapRuleType,
  TaxRuleContext,
  CGTRuleContext,
  Div293RuleContext,
  SuperCapRuleContext,
  TaxRuleResult,
  CGTResult,
  Div293Result,
  SuperCapRuleResult,
  RuleId,
} from './rules/tax';

import type { ISuperCapRule as SuperCapRule } from './rules/super';
import type { Year } from './types';

import { MarginalIncomeTaxRule, TAX_BRACKETS_2024_25, StandardCGTRule, Division293Rule } from './rules/tax';
import { StandardSuperCapRule } from './rules/super';

// ============================================
// RuleRegistry
// ============================================

export class RuleRegistry {
  private taxRules: ITaxRule[] = [];
  private cgtRules: ICGTRule[] = [];
  private div293Rules: IDiv293Rule[] = [];
  private superCapRules: SuperCapRule[] = [];

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  registerTaxRule(rule: ITaxRule): void {
    this.taxRules.push(rule);
  }

  registerCGTRule(rule: ICGTRule): void {
    this.cgtRules.push(rule);
  }

  registerDiv293Rule(rule: IDiv293Rule): void {
    this.div293Rules.push(rule);
  }

  registerSuperCapRule(rule: SuperCapRule): void {
    this.superCapRules.push(rule);
  }

  unregisterTaxRule(id: RuleId, version?: string): void {
    this.taxRules = this.taxRules.filter((r) => {
      if (r.id !== id) return true;
      if (version) return r.version !== version;
      return false;
    });
  }

  unregisterCGTRule(id: RuleId, version?: string): void {
    this.cgtRules = this.cgtRules.filter((r) => {
      if (r.id !== id) return true;
      if (version) return r.version !== version;
      return false;
    });
  }

  unregisterDiv293Rule(id: RuleId, version?: string): void {
    this.div293Rules = this.div293Rules.filter((r) => {
      if (r.id !== id) return true;
      if (version) return r.version !== version;
      return false;
    });
  }

  unregisterSuperCapRule(id: RuleId, version?: string): void {
    this.superCapRules = this.superCapRules.filter((r) => {
      if (r.id !== id) return true;
      if (version) return r.version !== version;
      return false;
    });
  }

  // ------------------------------------------------------------------
  // Resolution
  // ------------------------------------------------------------------

  getTaxRulesForYear(year: Year): ITaxRule[] {
    return this.taxRules.filter(
      (r) =>
        r.enabled &&
        year >= r.applicableYearRange.start &&
        year <= r.applicableYearRange.end
    );
  }

  getCGTRulesForYear(year: Year): ICGTRule[] {
    return this.cgtRules.filter(
      (r) =>
        r.enabled &&
        year >= r.applicableYearRange.start &&
        year <= r.applicableYearRange.end
    );
  }

  getDiv293RulesForYear(year: Year): IDiv293Rule[] {
    return this.div293Rules.filter(
      (r) =>
        r.enabled &&
        year >= r.applicableYearRange.start &&
        year <= r.applicableYearRange.end
    );
  }

  getSuperCapRulesForYear(year: Year): SuperCapRule[] {
    return this.superCapRules.filter(
      (r) =>
        r.enabled &&
        year >= r.applicableYearRange.start &&
        year <= r.applicableYearRange.end
    );
  }

  // ------------------------------------------------------------------
  // Convenience calculation methods
  // ------------------------------------------------------------------

  calculateIncomeTax(ctx: TaxRuleContext): TaxRuleResult {
    const rules = this.getTaxRulesForYear(ctx.year);
    let totalTaxPayable = 0;
    const allEvents: TaxRuleResult['taxEvents'] = [];

    for (const rule of rules) {
      if (!rule.isApplicable(ctx)) continue;
      const result = rule.calculate(ctx);
      totalTaxPayable += result.taxPayable;
      allEvents.push(...result.taxEvents);
    }

    return { taxPayable: totalTaxPayable, taxEvents: allEvents };
  }

  calculateCapitalGain(ctx: CGTRuleContext): CGTResult | null {
    const rules = this.getCGTRulesForYear(ctx.saleYear);
    if (rules.length === 0) return null;
    const rule = rules.find((r) => r.isApplicable(ctx as unknown as { year: Year }));
    if (!rule) return null;
    return rule.calculate(ctx);
  }

  calculateDiv293(ctx: Div293RuleContext & { year: Year }): Div293Result | null {
    const rules = this.getDiv293RulesForYear(ctx.year);
    const rule = rules.find((r) => r.isApplicable(ctx));
    if (!rule) return null;
    return rule.calculate(ctx);
  }

  getSuperCaps(ctx: SuperCapRuleContext): SuperCapRuleResult | null {
    const rules = this.getSuperCapRulesForYear(ctx.year);
    const rule = rules.find((r) => r.isApplicable(ctx));
    if (!rule) return null;
    return rule.calculate(ctx);
  }
}

// Default registry instance with built-in rules registered
export const defaultRuleRegistry = new RuleRegistry();
defaultRuleRegistry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));
defaultRuleRegistry.registerCGTRule(new StandardCGTRule());
defaultRuleRegistry.registerDiv293Rule(new Division293Rule());
defaultRuleRegistry.registerSuperCapRule(new StandardSuperCapRule());
