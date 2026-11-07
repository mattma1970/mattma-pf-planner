import type { AssumptionProfile, Assumptions, Epoch } from '../schemas';

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

export interface ResolvedAssumptions {
  cpi: number;
}

export function resolveAssumptions(
  assumptions: Assumptions,
  year: number,
  epochs: Epoch[]
): ResolvedAssumptions {
  const sortedEpochs = [...epochs].sort((a, b) => a.order - b.order);

  const getCpiForEpoch = (): number | undefined => {
    for (let i = sortedEpochs.length - 1; i >= 0; i--) {
      const epoch = sortedEpochs[i];
      if (year >= epoch.startYear && year <= epoch.endYear) {
        const override = epoch.globalAssumptions?.cpi;
        if (override !== undefined) return override;

        for (let j = i - 1; j >= 0; j--) {
          const prevOverride = sortedEpochs[j].globalAssumptions?.cpi;
          if (prevOverride !== undefined) return prevOverride;
        }
        break;
      }
    }
    return undefined;
  };

  const cpiOverride = getCpiForEpoch();
  const cpi = cpiOverride ?? resolveAssumptionForYear(assumptions.cpi, year);

  return { cpi };
}
