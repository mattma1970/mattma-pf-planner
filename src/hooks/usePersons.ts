import { useState, useEffect, useCallback } from 'react';
import type { Person } from '../schemas';
import * as personActions from '../actions/persons';

export function usePersons() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await personActions.getPersons();
      // Note: Tax account migration is now done in useAccounts to ensure proper load order
      setPersons(data);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Person, 'id'>) => {
    const person = await personActions.createPerson(data);
    await refresh();
    return person;
  };

  const update = async (id: string, updates: Partial<Person>) => {
    const person = await personActions.updatePerson(id, updates);
    await refresh();
    return person;
  };

  const remove = async (id: string) => {
    await personActions.deletePerson(id);
    await refresh();
  };

  return { persons, loading, error, refresh, create, update, remove };
}
