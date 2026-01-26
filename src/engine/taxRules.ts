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

export const rulesByYear: Record<number, TaxRule[]> = {
  2024: [
    { type: 'div293', threshold: 250000, rate: 0.15 },
  ],
  2025: [
    { type: 'div293', threshold: 250000, rate: 0.15 },
  ],
};

export function calculateAdditionalTaxes(ctx: RuleContext, year: number): number {
  let rules = rulesByYear[year];
  
  if (!rules) {
    const years = Object.keys(rulesByYear).map(Number).sort((a, b) => b - a);
    const mostRecentYear = years.find(y => y <= year) ?? years[0];
    rules = rulesByYear[mostRecentYear] ?? [];
  }
  
  return rules.reduce((total, rule) => total + applyRule(ctx, rule), 0);
}

export interface Div293TaxResult {
  applies: boolean;
  taxAmount: number;
  adjustedIncome: number;
  threshold: number;
  concessionalContributions: number;
}

export function calculateDiv293(
  taxableIncome: number,
  concessionalContributions: number,
  year: number
): Div293TaxResult {
  let rules = rulesByYear[year];
  
  if (!rules) {
    const years = Object.keys(rulesByYear).map(Number).sort((a, b) => b - a);
    const mostRecentYear = years.find(y => y <= year) ?? years[0];
    rules = rulesByYear[mostRecentYear] ?? [];
  }
  
  const div293Rule = rules.find((r): r is Div293Rule => r.type === 'div293');
  
  if (!div293Rule) {
    return {
      applies: false,
      taxAmount: 0,
      adjustedIncome: taxableIncome + concessionalContributions,
      threshold: 250000,
      concessionalContributions,
    };
  }
  
  const adjustedIncome = taxableIncome + concessionalContributions;
  const excess = Math.max(0, adjustedIncome - div293Rule.threshold);
  const taxBase = Math.min(excess, concessionalContributions);
  const taxAmount = taxBase * div293Rule.rate;
  
  return {
    applies: taxAmount > 0,
    taxAmount,
    adjustedIncome,
    threshold: div293Rule.threshold,
    concessionalContributions,
  };
}
