import Dexie, { type Table } from 'dexie';
import type { Account, Assumptions, Event, Person, Epoch, Settings } from '../schemas';

export class RetirementPlannerDB extends Dexie {
  accounts!: Table<Account>;
  events!: Table<Event>;
  persons!: Table<Person>;
  epochs!: Table<Epoch>;
  assumptions!: Table<Assumptions>;
  settings!: Table<Settings & { id: string }>;

  constructor() {
    super('RetirementPlannerDB');
    this.version(1).stores({
      accounts: 'id, type, owner',
      events: 'id, year, affectedAccountId',
      persons: 'id',
      epochs: 'id, order',
      assumptions: 'id',
    });
    this.version(2).stores({
      accounts: 'id, type, owner',
      events: 'id, year, affectedAccountId',
      persons: 'id',
      epochs: 'id, order',
      assumptions: 'id',
      settings: 'id',
    });
  }
}

export const db = new RetirementPlannerDB();
