import { v4 as uuidv4 } from 'uuid';
import type { Account } from '../schemas';
import { repository } from '../data';

export async function createAccount(data: Omit<Account, 'id'>): Promise<Account> {
  const account: Account = {
    ...data,
    id: uuidv4(),
  };
  await repository.saveAccount(account);
  return account;
}

export async function updateAccount(id: string, updates: Partial<Account>): Promise<Account> {
  const existing = await repository.getAccount(id);
  if (!existing) {
    throw new Error(`Account not found: ${id}`);
  }
  const updated: Account = { ...existing, ...updates, id };
  await repository.saveAccount(updated);
  return updated;
}

export async function deleteAccount(id: string): Promise<void> {
  await repository.deleteAccount(id);
}

export async function getAccounts(): Promise<Account[]> {
  const accounts = await repository.getAccounts();
  return accounts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function reorderAccounts(accountIds: string[]): Promise<void> {
  const accounts = await repository.getAccounts();
  
  for (let i = 0; i < accountIds.length; i++) {
    const account = accounts.find((a) => a.id === accountIds[i]);
    if (account) {
      await repository.saveAccount({ ...account, order: i });
    }
  }
}
