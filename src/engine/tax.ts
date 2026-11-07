/**
 * Tax calculation functions.
 *
 * This module now delegates to pluggable tax rules in src/domain/rules/tax.ts
 * via the RuleRegistry. The 2024-25 brackets are no longer hardcoded here;
 * they live in the domain rule MarginalIncomeTaxRule.
 *
 * Existing function signatures are preserved for backward compatibility with
 * the forecast engine and existing tests. New legislation can be added by
 * registering new ITaxRule implementations without modifying this file.
 */

import { TAX_BRACKETS_2024_25, type TaxBracket } from '../domain/rules/tax';
import { defaultRuleRegistry } from '../domain/registry';
import type { TaxRuleContext } from '../domain/types';

/**
 * Legacy interface retained for backward compatibility.
 */
export interface CgtCalculationResult {
  grossCapitalGain: number;
  discountApplied: boolean;
  discountedGain: number;
  costBase: number;
  saleProceeds: number;
}

/**
 * Calculate Australian income tax using the registered tax rules for the given year.
 *
 * Falls back to the built-in 2024-25 marginal brackets if no rule is registered
 * for the year (backward-compatible safety net).
 *
 * @param income - Assessable income in dollars
 * @param year - Financial year
 * @returns Tax payable in dollars
 */
export function calculateIncomeTax(income: number, year: number): number {
  if (income <= 0) {
    return 0;
  }

  const rules = defaultRuleRegistry.getTaxRulesForYear(year);
  if (rules.length === 0) {
    // Safety net: use built-in 2024-25 brackets if no rule registered
    return calculateIncomeTaxWithBrackets(income, TAX_BRACKETS_2024_25);
  }

  // Use the first applicable marginal income tax rule
  const rule = rules.find((r) => r.id === 'marginal-income-tax') ?? rules[0];
  const ctx: TaxRuleContext = {
    year,
    personId: 'unassigned',
    assessableIncome: income,
    concessionalContributions: 0,
    fundingAccountId: 'unassigned',
    fundingAccountName: 'Not configured',
  };

  const result = rule.calculate(ctx);
  return result.taxPayable;
}

/**
 * Calculate income tax directly from brackets (legacy fallback).
 */
function calculateIncomeTaxWithBrackets(income: number, brackets: TaxBracket[]): number {
  for (const bracket of brackets) {
    if (income >= bracket.min && income <= bracket.max) {
      const taxableInBracket = income - bracket.min + 1;
      return bracket.baseTax + taxableInBracket * bracket.rate;
    }
  }

  const topBracket = brackets[brackets.length - 1];
  const taxableInBracket = income - topBracket.min + 1;
  return topBracket.baseTax + taxableInBracket * topBracket.rate;
}

/**
 * Calculate capital gain using the registered CGT rule for the sale year.
 *
 * Falls back to the standard 50% discount rule if no CGT rule is registered.
 *
 * @param saleProceeds - Sale price
 * @param costBase - Cost base of the asset
 * @param acquisitionYear - Year the asset was acquired
 * @param saleYear - Year the asset is sold
 * @param eligibleForDiscount - Whether the asset is eligible for the CGT discount
 * @returns CGT calculation result
 */
export function calculateCapitalGain(
  saleProceeds: number,
  costBase: number,
  acquisitionYear: number,
  saleYear: number,
  eligibleForDiscount: boolean = true
): CgtCalculationResult {
  const cgtResult = defaultRuleRegistry.calculateCapitalGain({
    saleProceeds,
    costBase,
    acquisitionYear,
    saleYear,
    eligibleForDiscount,
    personId: 'unassigned',
    marginalTaxRate: 0, // CGT tax payable is computed by the tax engine using marginal rates
  });

  if (cgtResult) {
    return {
      grossCapitalGain: cgtResult.grossCapitalGain,
      discountApplied: cgtResult.discountApplied,
      discountedGain: cgtResult.discountedGain,
      costBase: cgtResult.costBase,
      saleProceeds: cgtResult.saleProceeds,
    };
  }

  // Fallback: standard CGT calculation (legacy behavior)
  const grossCapitalGain = Math.max(0, saleProceeds - costBase);
  const holdingYears = saleYear - acquisitionYear;
  const discountApplied = eligibleForDiscount && holdingYears >= 1 && grossCapitalGain > 0;
  const discountedGain = discountApplied
    ? grossCapitalGain * (1 - 0.5)
    : grossCapitalGain;

  return {
    grossCapitalGain,
    discountApplied,
    discountedGain,
    costBase,
    saleProceeds,
  };
}
