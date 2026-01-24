import { useState, useEffect, useCallback } from 'react';
import type { Event } from '../schemas';
import * as eventActions from '../actions/events';

export function useEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await eventActions.getEvents();
      setEvents(data);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Event, 'id'>) => {
    const event = await eventActions.createEvent(data);
    await refresh();
    return event;
  };

  const update = async (id: string, updates: Partial<Event>) => {
    const event = await eventActions.updateEvent(id, updates);
    await refresh();
    return event;
  };

  const remove = async (id: string) => {
    await eventActions.deleteEvent(id);
    await refresh();
  };

  return { events, loading, error, refresh, create, update, remove };
}
