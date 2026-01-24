import { v4 as uuidv4 } from 'uuid';
import type { Person } from '../schemas';
import { repository } from '../data';

export async function createPerson(data: Omit<Person, 'id'>): Promise<Person> {
  const person: Person = {
    ...data,
    id: uuidv4(),
  };
  await repository.savePerson(person);
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
  await repository.deletePerson(id);
}

export async function getPersons(): Promise<Person[]> {
  return repository.getPersons();
}
