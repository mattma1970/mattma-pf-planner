import { useState, useEffect, useCallback } from 'react';
import type { Epoch } from '../schemas';
import * as epochActions from '../actions/epochs';

export function useEpochs() {
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await epochActions.getEpochs();
      setEpochs(data);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Epoch, 'id'>) => {
    const epoch = await epochActions.createEpoch(data);
    await refresh();
    return epoch;
  };

  const update = async (id: string, updates: Partial<Epoch>) => {
    const epoch = await epochActions.updateEpoch(id, updates);
    await refresh();
    return epoch;
  };

  const remove = async (id: string) => {
    await epochActions.deleteEpoch(id);
    await refresh();
  };

  const reorder = async (epochIds: string[]) => {
    await epochActions.reorderEpochs(epochIds);
    await refresh();
  };

  return { epochs, loading, error, refresh, create, update, remove, reorder };
}
