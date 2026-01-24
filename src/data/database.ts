import Dexie, { type Table } from 'dexie';
import type { Account, Assumptions, Event, Person, Epoch } from '../schemas';

export class RetirementPlannerDB extends Dexie {
  accounts!: Table<Account>;
  events!: Table<Event>;
  persons!: Table<Person>;
  epochs!: Table<Epoch>;
  assumptions!: Table<Assumptions>;

  constructor() {
    super('RetirementPlannerDB');
    this.version(1).stores({
      accounts: 'id, type, owner',
      events: 'id, year, affectedAccountId',
      persons: 'id',
      epochs: 'id, order',
      assumptions: 'id',
    });
  }
}

export const db = new RetirementPlannerDB();
