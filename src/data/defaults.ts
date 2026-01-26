import { v4 as uuidv4 } from 'uuid';
import type { Assumptions, Person, Epoch } from '../schemas';

const currentYear = new Date().getFullYear();

export const DEFAULT_ASSUMPTIONS_ID = 'default-assumptions-id';

export const defaultAssumptions: Assumptions = {
  id: DEFAULT_ASSUMPTIONS_ID,
  cpi: { baseValue: 0.03 },
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

export function createDefaultEpochs(): Epoch[] {
  return [
    {
      id: uuidv4(),
      name: 'Accumulation',
      startYear: currentYear,
      endYear: currentYear + 25,
      order: 0,
      color: '#3b82f6',
    },
    {
      id: uuidv4(),
      name: 'Retirement',
      startYear: currentYear + 26,
      endYear: currentYear + 40,
      order: 1,
      color: '#10b981',
    },
  ];
}
