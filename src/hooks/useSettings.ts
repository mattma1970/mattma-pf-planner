import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../schemas';
import { defaultSettings } from '../schemas/settings';
import { repository } from '../data';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await repository.getSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await repository.saveSettings(newSettings);
  }, [settings]);

  return { settings, updateSettings, loading, refresh };
}
