import { describe, it, expect } from 'vitest';
import { calculateIncomeTax } from './tax';

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
