import { describe, it, expect } from 'vitest';
import { parsePlanFile } from './plan-file';
import { CURRENT_PLAN_VERSION } from '../schemas/plan-file';

describe('parsePlanFile', () => {
  const validPlanData = {
    persons: [],
    accounts: [],
    events: [],
    epochs: [],
    assumptions: {
      cpi: { baseValue: 0.025 },
    },
    settings: {
      eventHighlightColor: '#bfdbfe',
      growthCalculationMethod: 'openingBalance',
      super: {
        preservationAge: 67,
        concessionalCap: 30000,
        nonConcessionalCap: 120000,
        carryForwardYears: 5,
        contributionsTaxRate: 0.15,
        div293Threshold: 250000,
        div293Rate: 0.15,
        minimumDrawdownRates: {
          under65: 0.04,
          '65-74': 0.05,
          '75-79': 0.06,
          '80-84': 0.07,
          '85-89': 0.09,
          '90-94': 0.11,
          '95plus': 0.14,
        },
      },
      companyTaxRate: 0.30,
    },
  };

  it('should parse a valid plan file', () => {
    const planFile = {
      metadata: {
        version: CURRENT_PLAN_VERSION,
        exportedAt: new Date().toISOString(),
      },
      data: validPlanData,
    };

    const result = parsePlanFile(JSON.stringify(planFile));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persons).toEqual([]);
      expect(result.data.accounts).toEqual([]);
    }
  });

  it('should reject invalid JSON', () => {
    const result = parsePlanFile('not json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON format');
    }
  });

  it('should reject files without version', () => {
    const result = parsePlanFile(JSON.stringify({ data: validPlanData }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('missing metadata or version');
    }
  });

  it('should reject files with newer version than supported', () => {
    const planFile = {
      metadata: {
        version: CURRENT_PLAN_VERSION + 1,
        exportedAt: new Date().toISOString(),
      },
      data: validPlanData,
    };

    const result = parsePlanFile(JSON.stringify(planFile));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('newer than supported');
    }
  });

  it('should apply defaults for missing optional fields', () => {
    const planFile = {
      metadata: {
        version: CURRENT_PLAN_VERSION,
        exportedAt: new Date().toISOString(),
      },
      data: {
        persons: [],
        accounts: [],
        events: [],
        epochs: [],
        assumptions: {
          cpi: { baseValue: 0.025 },
        },
        settings: {},
      },
    };

    const result = parsePlanFile(JSON.stringify(planFile));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.eventHighlightColor).toBe('#bfdbfe');
      expect(result.data.settings.growthCalculationMethod).toBe('averageBalance');
    }
  });
});
