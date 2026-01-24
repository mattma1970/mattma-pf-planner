import { v4 as uuidv4 } from 'uuid';
import type { Assumptions, Person, Epoch } from '../schemas';

const currentYear = new Date().getFullYear();

export const DEFAULT_ASSUMPTIONS_ID = 'default-assumptions-id';

export const defaultAssumptions: Assumptions = {
  id: DEFAULT_ASSUMPTIONS_ID,
  cpi: { baseValue: 0.03 },
  investmentGrowth: { baseValue: 0.05 },
  superGrowth: { baseValue: 0.07 },
  startYear: currentYear,
  endYear: currentYear + 40,
};

export function createDefaultPerson(): Person {
  return {
    id: uuidv4(),
    name: 'Primary',
    birthYear: currentYear - 35,
    retirementYear: currentYear + 30,
    preservationAge: 60,
  };
}

export function createDefaultEpochs(personId: string): Epoch[] {
  return [
    {
      id: uuidv4(),
      name: 'Accumulation',
      startCondition: { type: 'year', year: currentYear },
      endCondition: { type: 'age', personId, age: 60 },
      order: 0,
    },
    {
      id: uuidv4(),
      name: 'Retirement',
      startCondition: { type: 'previousEpochEnd' },
      endCondition: { type: 'age', personId, age: 90 },
      order: 1,
    },
  ];
}
