import type { Account, Assumptions, Event, Person, Epoch } from '../schemas';
import { db } from './database';
import { defaultAssumptions, DEFAULT_ASSUMPTIONS_ID } from './defaults';

export interface DataRepository {
  getAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  saveAccount(account: Account): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  getEvents(): Promise<Event[]>;
  getEvent(id: string): Promise<Event | undefined>;
  saveEvent(event: Event): Promise<void>;
  deleteEvent(id: string): Promise<void>;

  getPersons(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  savePerson(person: Person): Promise<void>;
  deletePerson(id: string): Promise<void>;

  getEpochs(): Promise<Epoch[]>;
  getEpoch(id: string): Promise<Epoch | undefined>;
  saveEpoch(epoch: Epoch): Promise<void>;
  deleteEpoch(id: string): Promise<void>;

  getAssumptions(): Promise<Assumptions>;
  saveAssumptions(assumptions: Assumptions): Promise<void>;

  clearAll(): Promise<void>;
}

export class IndexedDBRepository implements DataRepository {
  async getAccounts(): Promise<Account[]> {
    return db.accounts.toArray();
  }

  async getAccount(id: string): Promise<Account | undefined> {
    return db.accounts.get(id);
  }

  async saveAccount(account: Account): Promise<void> {
    await db.accounts.put(account);
  }

  async deleteAccount(id: string): Promise<void> {
    await db.accounts.delete(id);
  }

  async getEvents(): Promise<Event[]> {
    return db.events.toArray();
  }

  async getEvent(id: string): Promise<Event | undefined> {
    return db.events.get(id);
  }

  async saveEvent(event: Event): Promise<void> {
    await db.events.put(event);
  }

  async deleteEvent(id: string): Promise<void> {
    await db.events.delete(id);
  }

  async getPersons(): Promise<Person[]> {
    return db.persons.toArray();
  }

  async getPerson(id: string): Promise<Person | undefined> {
    return db.persons.get(id);
  }

  async savePerson(person: Person): Promise<void> {
    await db.persons.put(person);
  }

  async deletePerson(id: string): Promise<void> {
    await db.persons.delete(id);
  }

  async getEpochs(): Promise<Epoch[]> {
    return db.epochs.orderBy('order').toArray();
  }

  async getEpoch(id: string): Promise<Epoch | undefined> {
    return db.epochs.get(id);
  }

  async saveEpoch(epoch: Epoch): Promise<void> {
    await db.epochs.put(epoch);
  }

  async deleteEpoch(id: string): Promise<void> {
    await db.epochs.delete(id);
  }

  async getAssumptions(): Promise<Assumptions> {
    const assumptions = await db.assumptions.get(DEFAULT_ASSUMPTIONS_ID);
    if (!assumptions) {
      return { ...defaultAssumptions };
    }
    return assumptions;
  }

  async saveAssumptions(assumptions: Assumptions): Promise<void> {
    await db.assumptions.put({ ...assumptions, id: DEFAULT_ASSUMPTIONS_ID });
  }

  async clearAll(): Promise<void> {
    await db.transaction('rw', [db.accounts, db.events, db.persons, db.epochs, db.assumptions], async () => {
      await db.accounts.clear();
      await db.events.clear();
      await db.persons.clear();
      await db.epochs.clear();
      await db.assumptions.clear();
    });
  }
}

export const repository = new IndexedDBRepository();
