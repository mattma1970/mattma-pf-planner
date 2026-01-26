import type { ForecastResult } from '../schemas';
import { repository } from '../data';
import { calculateForecast } from '../engine';
import { getEpochs } from './epochs';

export async function runForecast(startYear: number, endYear: number): Promise<ForecastResult> {
  const [accounts, assumptions, epochs, events, persons, settings] = await Promise.all([
    repository.getAccounts(),
    repository.getAssumptions(),
    getEpochs(),
    repository.getEvents(),
    repository.getPersons(),
    repository.getSettings(),
  ]);

  return calculateForecast({
    accounts,
    assumptions,
    epochs,
    events,
    persons,
    settings,
    startYear,
    endYear,
  });
}
