import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import type { Person, Account, AccountCategory } from '../schemas';
import { repository } from '../data';

// Tax account types to auto-create for each person
interface TaxAccountDefinition {
  nameSuffix: string;
  category: AccountCategory;
  specialConfigKind: 'concessionalCarryForward' | 'nonConcessionalCap' | 'frankingCredits';
}

// Namespace UUID for generating deterministic tax account IDs
// This is a fixed UUID used as the namespace for uuid v5
const TAX_ACCOUNT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // URL namespace

/**
 * Generate a deterministic UUID for a tax account.
 * This prevents race conditions from creating duplicate accounts -
 * concurrent calls will upsert the same record instead of creating new ones.
 * Uses uuid v5 to create a valid UUID from a deterministic string.
 */
function taxAccountId(personId: string, kind: TaxAccountDefinition['specialConfigKind']): string {
  return uuidv5(`tax-${personId}-${kind}`, TAX_ACCOUNT_NAMESPACE);
}

const TAX_ACCOUNT_DEFINITIONS: TaxAccountDefinition[] = [
  {
    nameSuffix: 'Concessional Carry Forward',
    category: 'taxCarryForward',
    specialConfigKind: 'concessionalCarryForward',
  },
  {
    nameSuffix: 'Non-Concessional Cap',
    category: 'taxCap',
    specialConfigKind: 'nonConcessionalCap',
  },
  {
    nameSuffix: 'Franking Credits',
    category: 'taxCap',
    specialConfigKind: 'frankingCredits',
  },
];

/**
 * Ensure tax accounts exist for a person.
 * Creates missing accounts with default values.
 */
export async function ensureTaxAccountsForPerson(person: Person): Promise<Account[]> {
  const existingAccounts = await repository.getAccounts();
  const createdAccounts: Account[] = [];

  for (const def of TAX_ACCOUNT_DEFINITIONS) {
    const accountName = `${person.name} - ${def.nameSuffix}`;
    
    // Find all accounts matching this owner + specialConfig.kind
    const matchingAccounts = existingAccounts.filter(
      (a) => a.owner === person.id && a.specialConfig?.kind === def.specialConfigKind
    );
    
    // Clean up any legacy duplicates (from before deterministic IDs)
    if (matchingAccounts.length > 1) {
      const [, ...duplicates] = matchingAccounts;
      for (const dup of duplicates) {
        await repository.deleteAccount(dup.id);
      }
    }
    
    const exists = matchingAccounts.length > 0;

    if (!exists) {
      const specialConfig = 
        def.specialConfigKind === 'concessionalCarryForward' 
          ? { kind: 'concessionalCarryForward' as const, buckets: [] }
          : def.specialConfigKind === 'nonConcessionalCap'
          ? { kind: 'nonConcessionalCap' as const, priorClosingBalance: 0 }
          : { kind: 'frankingCredits' as const };

      const account: Account = {
        id: taxAccountId(person.id, def.specialConfigKind),
        name: accountName,
        type: 'asset',
        category: def.category,
        includeInNetWorth: false,
        specialConfig,
        owner: person.id,
        initialValue: 0,
        growthProfile: { type: 'fixed', rate: 0 },
      };

      await repository.saveAccount(account);
      createdAccounts.push(account);
    }
  }

  return createdAccounts;
}

/**
 * Delete tax accounts for a person.
 */
export async function deleteTaxAccountsForPerson(personId: string): Promise<void> {
  const accounts = await repository.getAccounts();
  const taxAccounts = accounts.filter(
    (a) => a.owner === personId && a.category !== 'standard'
  );

  for (const account of taxAccounts) {
    await repository.deleteAccount(account.id);
  }
}

export async function createPerson(data: Omit<Person, 'id'>): Promise<Person> {
  const person: Person = {
    ...data,
    id: uuidv4(),
  };
  await repository.savePerson(person);
  
  // Auto-create tax accounts for the new person
  await ensureTaxAccountsForPerson(person);
  
  return person;
}

export async function updatePerson(id: string, updates: Partial<Person>): Promise<Person> {
  const existing = await repository.getPerson(id);
  if (!existing) {
    throw new Error(`Person not found: ${id}`);
  }
  const updated: Person = { ...existing, ...updates, id };
  await repository.savePerson(updated);
  return updated;
}

export async function deletePerson(id: string): Promise<void> {
  // Delete associated tax accounts first
  await deleteTaxAccountsForPerson(id);
  await repository.deletePerson(id);
}

export async function getPersons(): Promise<Person[]> {
  return repository.getPersons();
}

/**
 * Delete ALL tax accounts from the database (for cleanup purposes).
 * After calling this, you should refresh and the app will recreate them.
 * This bypasses schema validation to handle any corrupted/invalid accounts.
 */
export async function deleteAllTaxAccounts(): Promise<number> {
  // Import db directly to bypass schema validation
  const { db } = await import('../data/database');
  const rawAccounts = await db.accounts.toArray();
  const taxAccounts = rawAccounts.filter((a: { category?: string }) => 
    a.category && a.category !== 'standard'
  );
  
  for (const account of taxAccounts) {
    await db.accounts.delete(account.id);
  }
  
  return taxAccounts.length;
}
