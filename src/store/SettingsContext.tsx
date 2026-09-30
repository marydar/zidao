import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Settings } from '../types';
import { loadSettings, saveSettings } from '../services/storage/settingsStore';

interface SettingsContextValue {
  settings: Settings;
  /** Merge a partial update into one section. */
  setSection: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void;
  /** Replace the whole settings object. */
  replace: (next: Settings) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const THEME_COLORS: Record<Settings['theme'], string> = {
  dark: '#050e11',
  light: '#f3f7f7',
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.colorScheme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[settings.theme]);
  }, [settings.theme]);

  const setSection = useCallback(
    <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
      setSettings((prev) => {
        const current = prev[section];
        const next =
          current && typeof current === 'object'
            ? { ...current, ...patch }
            : (patch as Settings[K]);
        const merged: Settings = { ...prev, [section]: next };
        saveSettings(merged);
        return merged;
      });
    },
    [],
  );

  const replace = useCallback((next: Settings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const value = useMemo(() => ({ settings, setSection, replace }), [settings, setSection, replace]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
