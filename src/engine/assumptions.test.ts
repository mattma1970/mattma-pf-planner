import { describe, it, expect } from 'vitest';
import { resolveAssumptionForYear } from './assumptions';
import type { AssumptionProfile } from '../schemas';

describe('resolveAssumptionForYear', () => {
  it('returns baseValue when no overrides or formula', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.025,
    };

    expect(resolveAssumptionForYear(profile, 2024)).toBe(0.025);
    expect(resolveAssumptionForYear(profile, 2030)).toBe(0.025);
  });

  it('returns override value when override exists for year', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.025,
      overrides: {
        '2025': 0.03,
        '2026': 0.028,
      },
    };

    expect(resolveAssumptionForYear(profile, 2024)).toBe(0.025);
    expect(resolveAssumptionForYear(profile, 2025)).toBe(0.03);
    expect(resolveAssumptionForYear(profile, 2026)).toBe(0.028);
    expect(resolveAssumptionForYear(profile, 2027)).toBe(0.025);
  });

  it('parses formula "CPI+1" and adds 1 to CPI', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.04,
      formula: 'CPI+1',
    };

    const cpiValue = 0.025;
    expect(resolveAssumptionForYear(profile, 2024, cpiValue)).toBe(cpiValue + 1);
  });

  it('parses formula "CPI-0.5" and subtracts from CPI', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.04,
      formula: 'CPI-0.5',
    };

    const cpiValue = 0.025;
    expect(resolveAssumptionForYear(profile, 2024, cpiValue)).toBe(cpiValue - 0.5);
  });

  it('parses formula "CPI" alone and returns CPI value', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.04,
      formula: 'CPI',
    };

    const cpiValue = 0.025;
    expect(resolveAssumptionForYear(profile, 2024, cpiValue)).toBe(cpiValue);
  });

  it('returns baseValue when formula is invalid', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.04,
      formula: 'INVALID',
    };

    expect(resolveAssumptionForYear(profile, 2024, 0.025)).toBe(0.04);
  });

  it('override takes precedence over formula', () => {
    const profile: AssumptionProfile = {
      baseValue: 0.04,
      formula: 'CPI+1',
      overrides: {
        '2024': 0.05,
      },
    };

    expect(resolveAssumptionForYear(profile, 2024, 0.025)).toBe(0.05);
    expect(resolveAssumptionForYear(profile, 2025, 0.025)).toBe(0.025 + 1);
  });
});
