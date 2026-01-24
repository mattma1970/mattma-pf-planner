import type { ForecastResult } from '../schemas';
import { repository } from '../data';
import { calculateForecast } from '../engine';

export async function runForecast(startYear: number, endYear: number): Promise<ForecastResult> {
  const [accounts, assumptions, events, persons] = await Promise.all([
    repository.getAccounts(),
    repository.getAssumptions(),
    repository.getEvents(),
    repository.getPersons(),
  ]);

  return calculateForecast({
    accounts,
    assumptions,
    events,
    persons,
    startYear,
    endYear,
  });
}
