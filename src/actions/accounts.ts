import { v4 as uuidv4 } from 'uuid';
import type { Account, AccountInput, Event } from '../schemas';
import { AccountSchema } from '../schemas';
import { repository } from '../data';

export async function createAccount(data: Omit<AccountInput, 'id'>): Promise<Account> {
  // Use Zod parse to apply all defaults (category, includeInNetWorth, growthProfile sub-fields)
  const account = AccountSchema.parse({
    ...data,
    id: uuidv4(),
  });
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

export interface AccountReference {
  type: 'account' | 'event';
  id: string;
  name: string;
  field: string;
}

/**
 * Find all references to an account from other accounts and events.
 */
export async function findAccountReferences(accountId: string): Promise<AccountReference[]> {
  const accounts = await repository.getAccounts();
  const events = await repository.getEvents();
  const references: AccountReference[] = [];

  // Check account references
  for (const account of accounts) {
    if (account.id === accountId) continue;

    const accountRefFields: { field: keyof Account; label: string }[] = [
      { field: 'depositsToAccountId', label: 'Deposits To' },
      { field: 'fundedByAccountId', label: 'Funded By' },
      { field: 'transferToAccountId', label: 'Transfer To' },
      { field: 'incomeTargetAccountId', label: 'Income Target' },
      { field: 'taxFundedFromAccountId', label: 'Tax Funded From' },
      { field: 'offsetAccountId', label: 'Offset Account' },
      { field: 'payoffFromAccountId', label: 'Pay Off From' },
      { field: 'basedOnAccountId', label: 'Based On' },
    ];

    for (const { field, label } of accountRefFields) {
      if (account[field] === accountId) {
        references.push({
          type: 'account',
          id: account.id,
          name: account.name,
          field: label,
        });
      }
    }

    // Check auto-topup reference
    if (account.autoTopup?.fromAccountId === accountId) {
      references.push({
        type: 'account',
        id: account.id,
        name: account.name,
        field: 'Auto Top-up From',
      });
    }
  }

  // Check event references
  for (const event of events) {
    const eventRefFields: { field: keyof Event; label: string }[] = [
      { field: 'affectedAccountId', label: 'Affected Account' },
      { field: 'sourceAccountId', label: 'Source Account' },
      { field: 'targetAccountId', label: 'Target Account' },
      { field: 'taxFundedFromAccountId', label: 'Tax Funded From' },
    ];

    for (const { field, label } of eventRefFields) {
      if (event[field] === accountId) {
        references.push({
          type: 'event',
          id: event.id,
          name: `${event.year}: ${event.description}`,
          field: label,
        });
      }
    }
  }

  return references;
}

export interface DeleteAccountResult {
  success: boolean;
  error?: string;
  references?: AccountReference[];
}

/**
 * Delete an account. Returns an error with references if the account is still referenced.
 */
export async function deleteAccount(id: string): Promise<DeleteAccountResult> {
  const references = await findAccountReferences(id);
  
  if (references.length > 0) {
    return {
      success: false,
      error: 'Cannot delete account: it is referenced by other accounts or events',
      references,
    };
  }

  await repository.deleteAccount(id);
  return { success: true };
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
