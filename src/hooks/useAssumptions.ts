import { useState, useEffect, useCallback } from 'react';
import type { Assumptions } from '../schemas';
import * as assumptionActions from '../actions/assumptions';

export function useAssumptions() {
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await assumptionActions.getAssumptions();
      setAssumptions(data);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const update = async (updates: Partial<Assumptions>) => {
    const updated = await assumptionActions.updateAssumptions(updates);
    await refresh();
    return updated;
  };

  return { assumptions, loading, error, refresh, update };
}
