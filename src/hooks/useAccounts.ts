import { useState, useEffect, useCallback } from 'react';
import type { Account } from '../schemas';
import * as accountActions from '../actions/accounts';
import * as personActions from '../actions/persons';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      
      // First, ensure tax accounts exist for all persons (migration)
      const persons = await personActions.getPersons();
      for (const person of persons) {
        await personActions.ensureTaxAccountsForPerson(person);
      }
      
      // Now load all accounts (including newly created tax accounts)
      const data = await accountActions.getAccounts();
      setAccounts(data);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Account, 'id'>) => {
    const account = await accountActions.createAccount(data);
    await refresh();
    return account;
  };

  const update = async (id: string, updates: Partial<Account>) => {
    const account = await accountActions.updateAccount(id, updates);
    await refresh();
    return account;
  };

  const remove = async (id: string) => {
    const result = await accountActions.deleteAccount(id);
    if (result.success) {
      await refresh();
    }
    return result;
  };

  const reorder = async (accountIds: string[]) => {
    await accountActions.reorderAccounts(accountIds);
    await refresh();
  };

  return { accounts, loading, error, refresh, create, update, remove, reorder };
}
