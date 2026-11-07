/**
 * Tests for pluggable tax rules.
 *
 * These tests demonstrate the extensibility goal: a new tax year (e.g. 2025-26)
 * can be added as a new rule class without modifying src/engine/tax.ts or the
 * forecast engine.
 */

import {
  MarginalIncomeTaxRule,
  TAX_BRACKETS_2024_25,
  StandardCGTRule,
  Division293Rule,
  type ITaxRule,
  type TaxBracket,
} from './tax';
import { RuleRegistry, defaultRuleRegistry } from '../registry';
import type { TaxRuleContext } from '../types';

// ---------------------------------------------------------------------------
// Helper: define a hypothetical 2025-26 tax rule (different brackets)
// ---------------------------------------------------------------------------

const TAX_BRACKETS_2025_26: TaxBracket[] = [
  { min: 0, max: 18200, rate: 0, baseTax: 0 },
  { min: 18201, max: 45000, rate: 0.19, baseTax: 0 },
  { min: 45001, max: 120000, rate: 0.30, baseTax: 5092 }, // rate changed from 0.325
  { min: 120001, max: 180000, rate: 0.37, baseTax: 29467 },
  { min: 180001, max: Infinity, rate: 0.45, baseTax: 55367 }, // threshold changed from 190001
];

class MarginalIncomeTaxRule2025_26 implements ITaxRule {
  readonly id = 'marginal-income-tax';
  readonly version = '2025-26';
  readonly applicableYearRange = { start: 2025, end: 2025 };
  readonly enabled = true;

  constructor(private brackets: TaxBracket[] = TAX_BRACKETS_2025_26) {}

  isApplicable(ctx: TaxRuleContext): boolean {
    return ctx.year >= 2025 && ctx.year <= 2025;
  }

  calculate(ctx: TaxRuleContext): import('./tax').TaxRuleResult {
    const income = ctx.assessableIncome;
    const events: import('./tax').TaxRuleResult['taxEvents'] = [];
    if (income <= 0) return { taxPayable: 0, taxEvents: events };

    let taxPayable = 0;
    for (const bracket of this.brackets) {
      if (income >= bracket.min && income <= bracket.max) {
        taxPayable = bracket.baseTax + (income - bracket.min + 1) * bracket.rate;
        break;
      }
    }
    if (taxPayable === 0 && income > this.brackets[this.brackets.length - 1].min) {
      const top = this.brackets[this.brackets.length - 1];
      taxPayable = top.baseTax + (income - top.min + 1) * top.rate;
    }

    events.push({
      type: 'incomeTax',
      description: `Income Tax (${this.version})`,
      assessableAmount: income,
      personId: ctx.personId,
      metadata: { ruleId: this.id, version: this.version },
    });

    return { taxPayable, taxEvents: events };
  }
}

// ---------------------------------------------------------------------------
// MarginalIncomeTaxRule (2024-25)
// ---------------------------------------------------------------------------

describe('MarginalIncomeTaxRule (2024-25)', () => {
  const rule = new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25);

  it('applies to years 2024-2025 only', () => {
    expect(rule.isApplicable({ year: 2024, personId: 'p1', assessableIncome: 50000 })).toBe(true);
    expect(rule.isApplicable({ year: 2025, personId: 'p1', assessableIncome: 50000 })).toBe(true);
    expect(rule.isApplicable({ year: 2023, personId: 'p1', assessableIncome: 50000 })).toBe(false);
    expect(rule.isApplicable({ year: 2026, personId: 'p1', assessableIncome: 50000 })).toBe(false);
  });

  it('returns zero tax for income <= 0', () => {
    const result = rule.calculate({ year: 2024, personId: 'p1', assessableIncome: 0 });
    expect(result.taxPayable).toBe(0);
  });

  it('calculates tax in first bracket', () => {
    const result = rule.calculate({ year: 2024, personId: 'p1', assessableIncome: 10000 });
    expect(result.taxPayable).toBe(0);
  });

  it('calculates tax in second bracket', () => {
    // 18201-45000 at 19%: base 0, taxableInBracket = income - 18201 + 1
    const result = rule.calculate({ year: 2024, personId: 'p1', assessableIncome: 30000 });
    const expected = 0 + (30000 - 18201 + 1) * 0.19;
    expect(result.taxPayable).toBeCloseTo(expected, 2);
  });

  it('calculates tax in top bracket', () => {
    const result = rule.calculate({ year: 2024, personId: 'p1', assessableIncome: 250000 });
    const top = TAX_BRACKETS_2024_25[TAX_BRACKETS_2024_25.length - 1];
    const expected = top.baseTax + (250000 - top.min + 1) * top.rate;
    expect(result.taxPayable).toBeCloseTo(expected, 2);
  });

  it('generates a tax event with metadata', () => {
    const result = rule.calculate({ year: 2024, personId: 'p1', assessableIncome: 50000 });
    expect(result.taxEvents.length).toBe(1);
    expect(result.taxEvents[0].type).toBe('incomeTax');
    expect(result.taxEvents[0].metadata).toEqual({ ruleId: 'marginal-income-tax', version: '2024-25' });
  });
});

// ---------------------------------------------------------------------------
// StandardCGTRule
// ---------------------------------------------------------------------------

describe('StandardCGTRule', () => {
  const rule = new StandardCGTRule();

  it('applies to years 2024-2025 only', () => {
    expect(rule.isApplicable({ saleYear: 2024, saleProceeds: 100, costBase: 80, acquisitionYear: 2023, eligibleForDiscount: true, personId: 'p1', marginalTaxRate: 0.3 })).toBe(true);
    expect(rule.isApplicable({ saleYear: 2026, saleProceeds: 100, costBase: 80, acquisitionYear: 2023, eligibleForDiscount: true, personId: 'p1', marginalTaxRate: 0.3 })).toBe(false);
  });

  it('applies 50% discount when held > 1 year', () => {
    const result = rule.calculate({
      saleProceeds: 600000,
      costBase: 500000,
      acquisitionYear: 2020,
      saleYear: 2024,
      eligibleForDiscount: true,
      personId: 'p1',
      marginalTaxRate: 0.325,
    });
    expect(result.grossCapitalGain).toBe(100000);
    expect(result.discountApplied).toBe(true);
    expect(result.discountedGain).toBe(50000);
  });

  it('does not apply discount when held < 1 year (same year)', () => {
    const result = rule.calculate({
      saleProceeds: 600000,
      costBase: 500000,
      acquisitionYear: 2024,
      saleYear: 2024,
      eligibleForDiscount: true,
      personId: 'p1',
      marginalTaxRate: 0.325,
    });
    expect(result.discountApplied).toBe(false);
    expect(result.discountedGain).toBe(100000);
  });

  it('returns zero gain when sale below cost base', () => {
    const result = rule.calculate({
      saleProceeds: 400000,
      costBase: 500000,
      acquisitionYear: 2020,
      saleYear: 2024,
      eligibleForDiscount: true,
      personId: 'p1',
      marginalTaxRate: 0.325,
    });
    expect(result.grossCapitalGain).toBe(0);
    expect(result.discountApplied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Division293Rule
// ---------------------------------------------------------------------------

describe('Division293Rule', () => {
  const rule = new Division293Rule(250000, 0.15);

  it('applies when adjusted income exceeds threshold', () => {
    const result = rule.calculate({
      year: 2024,
      taxableIncome: 270000,
      concessionalContributions: 20000,
      threshold: 250000,
      rate: 0.15,
    });
    // adjustedIncome = 290000, excess = 40000, taxBase = min(40000, 20000) = 20000
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBeCloseTo(3000, 2);
    expect(result.adjustedIncome).toBe(290000);
  });

  it('does not apply when below threshold', () => {
    const result = rule.calculate({
      year: 2024,
      taxableIncome: 200000,
      concessionalContributions: 20000,
      threshold: 250000,
      rate: 0.15,
    });
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
  });

  it('caps tax base at concessional contributions', () => {
    const result = rule.calculate({
      year: 2024,
      taxableIncome: 500000,
      concessionalContributions: 30000,
      threshold: 250000,
      rate: 0.15,
    });
    // adjustedIncome = 530000, excess = 280000, taxBase = min(280000, 30000) = 30000
    expect(result.taxAmount).toBeCloseTo(4500, 2);
  });
});

// ---------------------------------------------------------------------------
// Extensibility: adding a new tax year rule (2025-26) WITHOUT touching engine
// ---------------------------------------------------------------------------

describe('Extensibility: new tax year rule (2025-26)', () => {
  it('2025-26 rule produces different tax than 2024-25 for the same income', () => {
    const rule2024 = new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25);
    const rule2025 = new MarginalIncomeTaxRule2025_26(TAX_BRACKETS_2025_26);

    const income = 200000;

    const r2024 = rule2024.calculate({ year: 2024, personId: 'p1', assessableIncome: income });
    const r2025 = rule2025.calculate({ year: 2025, personId: 'p1', assessableIncome: income });

    // Different brackets → different tax
    expect(r2025.taxPayable).not.toBe(r2024.taxPayable);
    expect(r2025.taxEvents[0].metadata).toEqual({ ruleId: 'marginal-income-tax', version: '2025-26' });
    expect(r2024.taxEvents[0].metadata).toEqual({ ruleId: 'marginal-income-tax', version: '2024-25' });
  });

  it('RuleRegistry can register and resolve the 2025-26 rule without engine changes', () => {
    // Register the new rule in a fresh registry (simulating a plugin load)
    const registry = new RuleRegistry();
    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));
    registry.registerTaxRule(new MarginalIncomeTaxRule2025_26(TAX_BRACKETS_2025_26));

    const rules2024 = registry.getTaxRulesForYear(2024);
    const rules2025 = registry.getTaxRulesForYear(2025);

    // 2024: only the 2024-25 rule applies
    expect(rules2024.length).toBe(1);
    expect(rules2024[0].version).toBe('2024-25');

    // 2025: both rules apply (2024-25 covers 2024-2025, 2025-26 covers 2025)
    expect(rules2025.length).toBe(2);
    const versions = rules2025.map((r) => r.version).sort();
    expect(versions).toEqual(['2024-25', '2025-26']);
  });

  it('defaultRuleRegistry.calculateIncomeTax delegates to registered rules', () => {
    // 2024 uses the default rule
    const tax2024 = defaultRuleRegistry.calculateIncomeTax({
      year: 2024,
      personId: 'p1',
      assessableIncome: 100000,
      concessionalContributions: 0,
    });
    expect(tax2024.taxPayable).toBeGreaterThan(0);

    // 2026 has no rule in default registry → taxPayable is 0 (no matching rule)
    // This proves that legislation must be explicitly registered for each year
    const tax2025 = defaultRuleRegistry.calculateIncomeTax({
      year: 2026,
      personId: 'p1',
      assessableIncome: 100000,
      concessionalContributions: 0,
    });
    expect(tax2025.taxPayable).toBe(0);
  });
});
