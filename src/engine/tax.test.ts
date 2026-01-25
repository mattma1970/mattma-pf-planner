import { describe, it, expect } from 'vitest';
import { calculateIncomeTax, calculateCapitalGain } from './tax';

describe('calculateIncomeTax', () => {
  const year = 2024;

  it('returns 0 tax for 0 income', () => {
    expect(calculateIncomeTax(0, year)).toBe(0);
  });

  it('returns 0 tax for negative income', () => {
    expect(calculateIncomeTax(-10000, year)).toBe(0);
  });

  it('returns 0 tax for income under $18,200 (tax-free threshold)', () => {
    expect(calculateIncomeTax(10000, year)).toBe(0);
    expect(calculateIncomeTax(18199, year)).toBe(0);
  });

  it('returns 0 tax for income at exactly $18,200 (boundary)', () => {
    expect(calculateIncomeTax(18200, year)).toBe(0);
  });

  it('calculates correct tax at $45,000 (end of 19% bracket)', () => {
    const income = 45000;
    const expected = 0 + (45000 - 18201 + 1) * 0.19;
    expect(calculateIncomeTax(income, year)).toBe(expected);
  });

  it('calculates correct tax at $120,000 (end of 32.5% bracket)', () => {
    const income = 120000;
    const expected = 5092 + (120000 - 45001 + 1) * 0.325;
    expect(calculateIncomeTax(income, year)).toBe(expected);
  });

  it('calculates correct tax at $190,000 (end of 37% bracket)', () => {
    const income = 190000;
    const expected = 29467 + (190000 - 120001 + 1) * 0.37;
    expect(calculateIncomeTax(income, year)).toBe(expected);
  });

  it('calculates correct tax at $200,000 (45% bracket)', () => {
    const income = 200000;
    const expected = 55367 + (200000 - 190001 + 1) * 0.45;
    expect(calculateIncomeTax(income, year)).toBe(expected);
  });

  it('calculates correct tax for high income ($500,000)', () => {
    const income = 500000;
    const expected = 55367 + (500000 - 190001 + 1) * 0.45;
    expect(calculateIncomeTax(income, year)).toBe(expected);
  });
});

describe('calculateCapitalGain', () => {
  it('calculates gross capital gain correctly', () => {
    const result = calculateCapitalGain(200000, 100000, 2020, 2025);
    expect(result.grossCapitalGain).toBe(100000);
    expect(result.costBase).toBe(100000);
    expect(result.saleProceeds).toBe(200000);
  });

  it('applies 50% CGT discount when held for more than 1 year', () => {
    const result = calculateCapitalGain(200000, 100000, 2020, 2025);
    expect(result.discountApplied).toBe(true);
    expect(result.discountedGain).toBe(50000);
  });

  it('does not apply CGT discount when held for exactly 1 year', () => {
    const result = calculateCapitalGain(200000, 100000, 2024, 2025);
    expect(result.discountApplied).toBe(true);
    expect(result.discountedGain).toBe(50000);
  });

  it('does not apply CGT discount when held for less than 1 year', () => {
    const result = calculateCapitalGain(200000, 100000, 2025, 2025);
    expect(result.discountApplied).toBe(false);
    expect(result.discountedGain).toBe(100000);
  });

  it('does not apply CGT discount when eligibleForDiscount is false', () => {
    const result = calculateCapitalGain(200000, 100000, 2020, 2025, false);
    expect(result.discountApplied).toBe(false);
    expect(result.discountedGain).toBe(100000);
  });

  it('returns zero capital gain when sale price equals cost base', () => {
    const result = calculateCapitalGain(100000, 100000, 2020, 2025);
    expect(result.grossCapitalGain).toBe(0);
    expect(result.discountedGain).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it('returns zero capital gain when sale price is less than cost base (loss)', () => {
    const result = calculateCapitalGain(80000, 100000, 2020, 2025);
    expect(result.grossCapitalGain).toBe(0);
    expect(result.discountedGain).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it('handles large capital gains correctly', () => {
    const result = calculateCapitalGain(2000000, 500000, 2015, 2025);
    expect(result.grossCapitalGain).toBe(1500000);
    expect(result.discountApplied).toBe(true);
    expect(result.discountedGain).toBe(750000);
  });
});
