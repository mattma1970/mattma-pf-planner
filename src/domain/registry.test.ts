/**
 * Tests for RuleRegistry - the plugin container for legislation rules.
 *
 * These tests prove that rules can be registered, resolved by year, and
 * swapped without modifying the registry or engine code.
 */

import { RuleRegistry, defaultRuleRegistry } from './registry';
import { MarginalIncomeTaxRule, StandardCGTRule, Division293Rule, TAX_BRACKETS_2024_25 } from './rules/tax';
import { StandardSuperCapRule } from './rules/super';
import type { TaxRuleContext, Year } from './types';

describe('RuleRegistry', () => {
  it('starts empty', () => {
    const registry = new RuleRegistry();
    expect(registry.getTaxRulesForYear(2024)).toEqual([]);
    expect(registry.getSuperCapRulesForYear(2024)).toEqual([]);
  });

  it('registers and retrieves tax rules by year', () => {
    const registry = new RuleRegistry();
    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));

    const rules2024 = registry.getTaxRulesForYear(2024);
    const rules2025 = registry.getTaxRulesForYear(2025);
    const rules2023 = registry.getTaxRulesForYear(2023);

    expect(rules2024.length).toBe(1);
    expect(rules2024[0].version).toBe('2024-25');

    // 2025 is within range
    expect(rules2025.length).toBe(1);
    // 2023 is outside range
    expect(rules2023.length).toBe(0);
  });

  it('registers multiple rules with the same id (additive, not replacing)', () => {
    const registry = new RuleRegistry();

    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));
    let rules = registry.getTaxRulesForYear(2024);
    expect(rules.length).toBe(1);
    expect(rules[0].version).toBe('2024-25');

    // Registering another rule with the same id adds it (both match year 2024)
    class PatchedRule extends MarginalIncomeTaxRule {
      readonly version = '2024-25-patch';
      constructor() { super(TAX_BRACKETS_2024_25); }
    }
    registry.registerTaxRule(new PatchedRule());

    rules = registry.getTaxRulesForYear(2024);
    expect(rules.length).toBe(2);
    const versions = rules.map((r) => r.version).sort();
    expect(versions).toEqual(['2024-25', '2024-25-patch']);

    // Unregister by id removes all matching versions
    registry.unregisterTaxRule('marginal-income-tax');
    expect(registry.getTaxRulesForYear(2024).length).toBe(0);
  });

  it('unregisters tax rules', () => {
    const registry = new RuleRegistry();
    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));
    expect(registry.getTaxRulesForYear(2024).length).toBe(1);

    registry.unregisterTaxRule('marginal-income-tax');
    expect(registry.getTaxRulesForYear(2024).length).toBe(0);
  });

  it('calculates income tax via convenience method', () => {
    const registry = new RuleRegistry();
    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));

    const result = registry.calculateIncomeTax({
      year: 2024,
      personId: 'p1',
      assessableIncome: 50000,
      concessionalContributions: 0,
    });

    expect(result.taxPayable).toBeGreaterThan(0);
    expect(result.taxEvents.length).toBe(1);
  });

  it('calculates income tax as zero when no rule matches year', () => {
    const registry = new RuleRegistry();
    registry.registerTaxRule(new MarginalIncomeTaxRule(TAX_BRACKETS_2024_25));

    const result = registry.calculateIncomeTax({
      year: 2030,
      personId: 'p1',
      assessableIncome: 50000,
      concessionalContributions: 0,
    });

    expect(result.taxPayable).toBe(0);
    expect(result.taxEvents).toEqual([]);
  });

  it('registers and resolves CGT rules', () => {
    const registry = new RuleRegistry();
    registry.registerCGTRule(new StandardCGTRule());

    const rules2024 = registry.getCGTRulesForYear(2024);
    const rules2026 = registry.getCGTRulesForYear(2026);

    expect(rules2024.length).toBe(1);
    expect(rules2026.length).toBe(0);
  });

  it('registers and resolves Div293 rules', () => {
    const registry = new RuleRegistry();
    registry.registerDiv293Rule(new Division293Rule());

    const rules = registry.getDiv293RulesForYear(2024);
    expect(rules.length).toBe(1);
    expect(rules[0].version).toBe('2024-25');
  });

  it('registers and resolves super cap rules', () => {
    const registry = new RuleRegistry();
    registry.registerSuperCapRule(new StandardSuperCapRule());

    const rules2024 = registry.getSuperCapRulesForYear(2024);
    const rules2026 = registry.getSuperCapRulesForYear(2026);

    expect(rules2024.length).toBe(1);
    expect(rules2026.length).toBe(0);

    const caps = registry.getSuperCaps({ year: 2024, personId: 'p1' });
    expect(caps).not.toBeNull();
    expect(caps?.concessionalCap).toBe(30000);
    expect(caps?.nonConcessionalCap).toBe(120000);
  });

  it('defaultRuleRegistry has built-in rules pre-registered', () => {
    const taxRules = defaultRuleRegistry.getTaxRulesForYear(2024);
    expect(taxRules.length).toBeGreaterThan(0);
    expect(taxRules.some((r) => r.id === 'marginal-income-tax')).toBe(true);

    const cgtRules = defaultRuleRegistry.getCGTRulesForYear(2024);
    expect(cgtRules.length).toBeGreaterThan(0);

    const superRules = defaultRuleRegistry.getSuperCapRulesForYear(2024);
    expect(superRules.length).toBeGreaterThan(0);
  });

  it('calculateDiv293 requires year context', () => {
    const registry = new RuleRegistry();
    registry.registerDiv293Rule(new Division293Rule(250000, 0.15));

    const result = registry.calculateDiv293({
      year: 2024,
      taxableIncome: 270000,
      concessionalContributions: 20000,
      threshold: 250000,
      rate: 0.15,
    });

    expect(result).not.toBeNull();
    expect(result?.applies).toBe(true);
    expect(result?.taxAmount).toBeCloseTo(3000, 2);
  });
});
