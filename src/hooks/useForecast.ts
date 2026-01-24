import { useState, useEffect, useCallback } from 'react';
import type { ForecastResult } from '../schemas';
import { runForecast } from '../actions/forecast';

export function useForecast(startYear: number, endYear: number) {
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await runForecast(startYear, endYear);
      setForecast(result);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [startYear, endYear]);

  useEffect(() => { refresh(); }, [refresh]);

  return { forecast, loading, error, refresh };
}
