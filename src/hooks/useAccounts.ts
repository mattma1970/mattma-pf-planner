import { useState, useEffect, useCallback } from 'react';
import type { Account } from '../schemas';
import * as accountActions from '../actions/accounts';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
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
    await accountActions.deleteAccount(id);
    await refresh();
  };

  const reorder = async (accountIds: string[]) => {
    await accountActions.reorderAccounts(accountIds);
    await refresh();
  };

  return { accounts, loading, error, refresh, create, update, remove, reorder };
}
