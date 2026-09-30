import type { Settings } from '../../types';

const KEY = 'hanzi-practice.settings.v1';

export const defaultSettings: Settings = {
  version: 1,
  theme: 'dark',
  display: {
    mode: 'hanzi-pinyin',
    fontScale: 1,
    showGrid: true,
    animationSpeed: 1,
  },
  practice: {
    mode: 'sequential',
    sessionSize: 20,
    autoPlay: true,
    autoNext: true,
    autoHintAfter: 2,
    quiz: 'dictation',
  },
  audio: {
    enabled: true,
    voiceURI: null,
    locale: 'zh-CN',
    rate: 1,
    volume: 1,
  },
  handwriting: {
    brushWidth: 0.055,
    smoothing: 0.45,
    strictness: 'normal',
    hintMode: 'next',
  },
};

const listeners = new Set<(s: Settings) => void>();
let cached: Settings | null = null;

function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  if (!saved || typeof saved !== 'object') return { ...defaultSettings };
  return {
    ...defaultSettings,
    ...saved,
    version: defaultSettings.version,
    display: { ...defaultSettings.display, ...saved.display },
    practice: { ...defaultSettings.practice, ...saved.practice },
    audio: { ...defaultSettings.audio, ...saved.audio },
    handwriting: { ...defaultSettings.handwriting, ...saved.handwriting },
  };
}

/** Load settings (localStorage). Never throws — falls back to defaults. */
export function loadSettings(): Settings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = mergeSettings(raw ? (JSON.parse(raw) as Partial<Settings>) : null);
  } catch {
    cached = { ...defaultSettings };
  }
  return cached;
}

export function saveSettings(settings: Settings): void {
  cached = settings;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    // Persistence failures must not break the UI.
    console.warn('Could not save settings', err);
  }
  for (const cb of listeners) cb(settings);
}

export function updateSettings(patch: (current: Settings) => Settings): void {
  saveSettings(patch(loadSettings()));
}

export function subscribeSettings(cb: (s: Settings) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
