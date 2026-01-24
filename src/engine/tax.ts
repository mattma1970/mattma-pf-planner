interface TaxBracket {
  min: number;
  max: number;
  rate: number;
  baseTax: number;
}

const TAX_BRACKETS_2024_25: TaxBracket[] = [
  { min: 0, max: 18200, rate: 0, baseTax: 0 },
  { min: 18201, max: 45000, rate: 0.19, baseTax: 0 },
  { min: 45001, max: 120000, rate: 0.325, baseTax: 5092 },
  { min: 120001, max: 190000, rate: 0.37, baseTax: 29467 },
  { min: 190001, max: Infinity, rate: 0.45, baseTax: 55367 },
];

function getTaxBrackets(_year: number): TaxBracket[] {
  return TAX_BRACKETS_2024_25;
}

export function calculateIncomeTax(income: number, year: number): number {
  if (income <= 0) {
    return 0;
  }

  const brackets = getTaxBrackets(year);

  for (const bracket of brackets) {
    if (income >= bracket.min && income <= bracket.max) {
      const taxableInBracket = income - bracket.min + 1;
      return bracket.baseTax + taxableInBracket * bracket.rate;
    }
  }

  const topBracket = brackets[brackets.length - 1];
  const taxableInBracket = income - topBracket.min + 1;
  return topBracket.baseTax + taxableInBracket * topBracket.rate;
}
