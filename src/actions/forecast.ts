import type { ForecastResult } from '../schemas';
import { repository } from '../data';
import { calculateForecast } from '../engine';

export async function runForecast(startYear: number, endYear: number): Promise<ForecastResult> {
  const [accounts, assumptions, events, persons, settings] = await Promise.all([
    repository.getAccounts(),
    repository.getAssumptions(),
    repository.getEvents(),
    repository.getPersons(),
    repository.getSettings(),
  ]);

  return calculateForecast({
    accounts,
    assumptions,
    events,
    persons,
    settings,
    startYear,
    endYear,
  });
}
