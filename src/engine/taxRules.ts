import type { SuperSettings } from '../schemas/settings';
import { defaultSuperSettings } from '../schemas/settings';

export interface RuleContext {
  taxableIncome: number;
  concessionalContributions: number;
  nonConcessionalContributions: number;
  superBalance: number;
  familyIncome: number;
}

export interface Div293Rule {
  type: 'div293';
  threshold: number;
  rate: number;
}

export type TaxRule = Div293Rule;

export function applyDiv293Rule(ctx: RuleContext, rule: Div293Rule): number {
  const excess = Math.max(0, ctx.taxableIncome + ctx.concessionalContributions - rule.threshold);
  const taxBase = Math.min(excess, ctx.concessionalContributions);
  return taxBase * rule.rate;
}

export function applyRule(ctx: RuleContext, rule: TaxRule): number {
  switch (rule.type) {
    case 'div293':
      return applyDiv293Rule(ctx, rule);
    default:
      return 0;
  }
}

/**
 * Get tax rules from super settings
 */
export function getRulesFromSettings(superSettings: SuperSettings = defaultSuperSettings): TaxRule[] {
  return [
    { 
      type: 'div293', 
      threshold: superSettings.div293Threshold, 
      rate: superSettings.div293Rate,
    },
  ];
}

/**
 * Calculate additional taxes using settings
 */
export function calculateAdditionalTaxes(
  ctx: RuleContext, 
  superSettings: SuperSettings = defaultSuperSettings
): number {
  const rules = getRulesFromSettings(superSettings);
  return rules.reduce((total, rule) => total + applyRule(ctx, rule), 0);
}

export interface Div293TaxResult {
  applies: boolean;
  taxAmount: number;
  adjustedIncome: number;
  threshold: number;
  concessionalContributions: number;
}

/**
 * Calculate Division 293 tax
 */
export function calculateDiv293(
  taxableIncome: number,
  concessionalContributions: number,
  superSettings: SuperSettings = defaultSuperSettings
): Div293TaxResult {
  const { div293Threshold, div293Rate } = superSettings;
  
  const adjustedIncome = taxableIncome + concessionalContributions;
  const excess = Math.max(0, adjustedIncome - div293Threshold);
  const taxBase = Math.min(excess, concessionalContributions);
  const taxAmount = taxBase * div293Rate;
  
  return {
    applies: taxAmount > 0,
    taxAmount,
    adjustedIncome,
    threshold: div293Threshold,
    concessionalContributions,
  };
}
