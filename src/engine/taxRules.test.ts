import { describe, it, expect } from 'vitest';
import type { RuleContext, Div293Rule, TaxRule } from './taxRules';
import {
  applyDiv293Rule,
  applyRule,
  calculateAdditionalTaxes,
  calculateDiv293,
} from './taxRules';

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

describe('calculateAdditionalTaxes', () => {
  it('applies rules for specified year', () => {
    const ctx = createContext({
      taxableIncome: 260000,
      concessionalContributions: 27500,
    });
    const result = calculateAdditionalTaxes(ctx, 2024);
    expect(result).toBe(27500 * 0.15);
  });

  it('falls back to most recent year if year not found', () => {
    const ctx = createContext({
      taxableIncome: 260000,
      concessionalContributions: 27500,
    });
    const result = calculateAdditionalTaxes(ctx, 2026);
    expect(result).toBe(27500 * 0.15);
  });

  it('returns 0 when no taxes apply', () => {
    const ctx = createContext({
      taxableIncome: 100000,
      concessionalContributions: 10000,
    });
    expect(calculateAdditionalTaxes(ctx, 2024)).toBe(0);
  });
});

describe('calculateDiv293', () => {
  it('returns applies=false when income below threshold', () => {
    const result = calculateDiv293(200000, 27500, 2024);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.adjustedIncome).toBe(227500);
    expect(result.threshold).toBe(250000);
    expect(result.concessionalContributions).toBe(27500);
  });

  it('taxes partial contributions when income + contributions partially above threshold', () => {
    const result = calculateDiv293(240000, 27500, 2024);
    const excess = 240000 + 27500 - 250000; // 17500
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(excess * 0.15);
    expect(result.adjustedIncome).toBe(267500);
  });

  it('taxes full contributions when income + contributions way above threshold', () => {
    const result = calculateDiv293(300000, 27500, 2024);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(27500 * 0.15);
    expect(result.adjustedIncome).toBe(327500);
  });

  it('returns applies=false at exact threshold', () => {
    const result = calculateDiv293(222500, 27500, 2024);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.adjustedIncome).toBe(250000);
  });

  it('taxes $1 over threshold correctly', () => {
    const result = calculateDiv293(222501, 27500, 2024);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(1 * 0.15);
    expect(result.adjustedIncome).toBe(250001);
  });

  it('returns applies=false when contributions are zero', () => {
    const result = calculateDiv293(300000, 0, 2024);
    expect(result.applies).toBe(false);
    expect(result.taxAmount).toBe(0);
    expect(result.concessionalContributions).toBe(0);
  });

  it('falls back to most recent year rules for future years', () => {
    const result = calculateDiv293(300000, 27500, 2030);
    expect(result.applies).toBe(true);
    expect(result.taxAmount).toBe(27500 * 0.15);
    expect(result.threshold).toBe(250000);
  });
});
