import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Register keyboard shortcuts. Keys are lowercase (e.g. ' ', 'enter', 'r').
 * Text inputs are ignored; modifiers never trigger.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const fn = mapRef.current[key];
      if (!fn) return;
      // Let focused buttons handle their own Space/Enter activation.
      if ((key === ' ' || key === 'enter') && event.target instanceof HTMLElement) {
        if (event.target.tagName === 'BUTTON' || event.target.tagName === 'A') return;
      }
      fn(event);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
