import type { AssumptionProfile } from '../schemas';

export function resolveAssumptionForYear(
  profile: AssumptionProfile,
  year: number,
  cpiValue?: number
): number {
  if (profile.overrides && profile.overrides[year] !== undefined) {
    return profile.overrides[year];
  }

  if (profile.formula) {
    return parseFormula(profile.formula, profile.baseValue, cpiValue);
  }

  return profile.baseValue;
}

function parseFormula(formula: string, baseValue: number, cpiValue?: number): number {
  const normalized = formula.toLowerCase().replace(/\s+/g, '');

  const cpiMatch = normalized.match(/^cpi([+-])(\d+(?:\.\d+)?)$/);
  if (cpiMatch && cpiValue !== undefined) {
    const operator = cpiMatch[1];
    const offset = parseFloat(cpiMatch[2]);
    return operator === '+' ? cpiValue + offset : cpiValue - offset;
  }

  if (normalized === 'cpi' && cpiValue !== undefined) {
    return cpiValue;
  }

  return baseValue;
}
