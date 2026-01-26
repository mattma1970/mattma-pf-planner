import { describe, it, expect } from 'vitest';
import type { RuleContext, Div293Rule, TaxRule } from './taxRules';
import {
  applyDiv293Rule,
  applyRule,
  calculateAdditionalTaxes,
  calculateDiv293,
  getRulesFromSettings,
} from './taxRules';
import type { SuperSettings } from '../schemas/settings';
import { defaultSuperSettings } from '../schemas/settings';

const createContext = (overrides: Partial<RuleContext> = {}): RuleContext => ({
  taxableIncome: 0,
  concessionalContributions: 0,
  nonConcessionalContributions: 0,
  superBalance: 0,
  familyIncome: 0,
  ...overrides,
});

const div293Rule: Div293Rule = { type: 'div293', threshold: 250000, rate: 0.15 };

describe('applyDiv293Rule', () => {
  it('returns 0 when income + contributions below threshold', () => {
    const ctx = createContext({
      taxableIncome: 200000,
      concessionalContributions: 27500,
    });
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(0);
  });

  it('taxes excess when income + contributions above threshold and excess < contributions', () => {
    const ctx = createContext({
      taxableIncome: 240000,
      concessionalContributions: 27500,
    });
    const excess = 240000 + 27500 - 250000; // 17500
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(excess * 0.15);
  });

  it('caps tax base at contributions when excess > contributions', () => {
    const ctx = createContext({
      taxableIncome: 300000,
      concessionalContributions: 27500,
    });
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(27500 * 0.15);
  });

  it('returns 0 when contributions are zero', () => {
    const ctx = createContext({
      taxableIncome: 300000,
      concessionalContributions: 0,
    });
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(0);
  });

  it('returns 0 at exact threshold', () => {
    const ctx = createContext({
      taxableIncome: 222500,
      concessionalContributions: 27500,
    });
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(0);
  });

  it('taxes $1 over threshold correctly', () => {
    const ctx = createContext({
      taxableIncome: 222501,
      concessionalContributions: 27500,
    });
    expect(applyDiv293Rule(ctx, div293Rule)).toBe(1 * 0.15);
  });
});

describe('applyRule', () => {
  it('dispatches div293 rule correctly', () => {
    const ctx = createContext({
      taxableIncome: 260000,
      concessionalContributions: 27500,
    });
    const result = applyRule(ctx, div293Rule);
    expect(result).toBe(applyDiv293Rule(ctx, div293Rule));
  });

  it('returns 0 for unknown rule types', () => {
    const ctx = createContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unknownRule = { type: 'unknown' } as unknown as TaxRule;
    expect(applyRule(ctx, unknownRule)).toBe(0);
  });
});

describe('getRulesFromSettings', () => {
  it('creates div293 rule from settings', () => {
    const rules = getRulesFromSettings(defaultSuperSettings);
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('div293');
    expect(rules[0].threshold).toBe(250000);
    expect(rules[0].rate).toBe(0.15);
  });

  it('uses custom settings', () => {
    const customSettings: SuperSettings = {
      ...defaultSuperSettings,
      div293Threshold: 300000,
      div293Rate: 0.20,
    };
    const rules = getRulesFromSettings(customSettings);
    expect(rules[0].threshold).toBe(300000);
    expect(rules[0].rate).toBe(0.20);
  });
});

describe('calculateAdditionalTaxes', () => {
  it('applies rules from settings', () => {
    const ctx = createContext({
      taxableIncome: 260000,
      concessionalContributions: 27500,
    });
    const result = calculateAdditionalTaxes(ctx, defaultSuperSettings);
    expect(result).toBe(27500 * 0.15);
  });

  it('uses custom settings thresholds', () => {
    const ctx = createContext({
      taxableIncome: 260000,
      concessionalContributions: 27500,
    });
    const customSettings: SuperSettings = {
      ...defaultSuperSettings,
      div293Threshold: 300000, // Higher threshold
    };
    const result = calculateAdditionalTaxes(ctx, customSettings);
    expect(result).toBe(0); // Below threshold now
  });

  it('returns 0 when no taxes apply', () => {
    const ctx = createContext({
      taxableIncome: 100000,
      concessionalContributions: 10000,
    });
    expect(calculateAdditionalTaxes(ctx, defaultSuperSettings)).toBe(0);
  });
});

describe('calculateDiv293', () => {
  it('returns applies=false when income below threshold', () => {
    const result = calculateDiv293(200000, 27500, defaultSuperSettings);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.adjustedIncome).toBe(227500);
    expect(result.threshold).toBe(250000);
    expect(result.concessionalContributions).toBe(27500);
  });

  it('taxes partial contributions when income + contributions partially above threshold', () => {
    const result = calculateDiv293(240000, 27500, defaultSuperSettings);
    const excess = 240000 + 27500 - 250000; // 17500
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(excess * 0.15);
    expect(result.adjustedIncome).toBe(267500);
  });

  it('taxes full contributions when income + contributions way above threshold', () => {
    const result = calculateDiv293(300000, 27500, defaultSuperSettings);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(27500 * 0.15);
    expect(result.adjustedIncome).toBe(327500);
  });

  it('returns applies=false at exact threshold', () => {
    const result = calculateDiv293(222500, 27500, defaultSuperSettings);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.adjustedIncome).toBe(250000);
  });

  it('taxes $1 over threshold correctly', () => {
    const result = calculateDiv293(222501, 27500, defaultSuperSettings);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(1 * 0.15);
    expect(result.adjustedIncome).toBe(250001);
  });

  it('returns applies=false when contributions are zero', () => {
    const result = calculateDiv293(300000, 0, defaultSuperSettings);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.concessionalContributions).toBe(0);
  });

  it('uses custom settings', () => {
    const customSettings: SuperSettings = {
      ...defaultSuperSettings,
      div293Threshold: 200000,
      div293Rate: 0.20,
    };
    const result = calculateDiv293(200000, 27500, customSettings);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(27500 * 0.20);
    expect(result.threshold).toBe(200000);
  });
});
