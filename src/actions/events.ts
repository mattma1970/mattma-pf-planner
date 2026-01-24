import { v4 as uuidv4 } from 'uuid';
import type { Event } from '../schemas';
import { repository } from '../data';

export async function createEvent(data: Omit<Event, 'id'>): Promise<Event> {
  const event: Event = {
    ...data,
    id: uuidv4(),
  };
  await repository.saveEvent(event);
  return event;
}

export async function updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
  const existing = await repository.getEvent(id);
  if (!existing) {
    throw new Error(`Event not found: ${id}`);
  }
  const updated: Event = { ...existing, ...updates, id };
  await repository.saveEvent(updated);
  return updated;
}

export async function deleteEvent(id: string): Promise<void> {
  await repository.deleteEvent(id);
}

export async function getEvents(): Promise<Event[]> {
  return repository.getEvents();
}
