import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '../schemas';
import { defaultSettings } from '../schemas/settings';
import { repository } from '../data';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    repository.getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await repository.saveSettings(newSettings);
  }, [settings]);

  return { settings, updateSettings, loading };
}
