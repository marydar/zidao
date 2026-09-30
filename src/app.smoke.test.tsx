// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { setSessionDraft } from './services/vocabulary/sessionDraft';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function settle(predicate: () => boolean, tries = 120): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  return predicate();
}

async function renderAt(path: string): Promise<HTMLDivElement> {
  window.history.pushState({}, '', path);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(<App />);
  });
  return el;
}

beforeEach(() => {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  window.localStorage.clear();
  // Keep tests hermetic: stroke data falls back to the offline bundle.
  globalThis.fetch = (() => Promise.reject(new Error('offline test'))) as typeof fetch;
  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopObserver;
});

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

describe('app smoke', () => {
  it('renders the dashboard with its main call to action', async () => {
    const el = await renderAt('/');
    expect(await settle(() => el.textContent?.includes('Start practicing') ?? false)).toBe(true);
    expect(el.querySelector('.act-grid')).toBeTruthy();
  });

  it('renders the practice setup with the course picker', async () => {
    const el = await renderAt('/practice');
    expect(await settle(() => !!el.querySelector('.book-card'))).toBe(true);
    // The word-count preview resolves once the vocabulary index is imported.
    expect(await settle(() => el.textContent?.includes('Start session') ?? false)).toBe(true);
    expect(el.textContent).toContain('Lessons');
  });

  it('renders the vocabulary browser', async () => {
    const el = await renderAt('/vocabulary');
    expect(await settle(() => el.textContent?.includes('Look up any word') ?? false)).toBe(true);
    expect(el.querySelector('.search-box')).toBeTruthy();
  });

  it('renders the progress page empty state', async () => {
    const el = await renderAt('/progress');
    expect(
      await settle(() => el.textContent?.includes('No practice recorded yet') ?? false),
    ).toBe(true);
  });

  it('renders settings with handwriting controls', async () => {
    const el = await renderAt('/settings');
    expect(await settle(() => el.textContent?.includes('Strictness') ?? false)).toBe(true);
    expect(el.textContent).toContain('Reset progress');
  });

  it('offers to start a session when none is in progress', async () => {
    const el = await renderAt('/practice/session');
    expect(
      await settle(() => el.textContent?.includes('No session in progress') ?? false),
    ).toBe(true);
    expect(el.textContent).toContain('Start a session');
  });

  it('starts a dictation session with the hanzi hidden', async () => {
    setSessionDraft({
      selection: { words: ['你', '好'], mode: 'sequential', size: 5, quiz: 'dictation' },
      label: 'Test words',
    });
    const el = await renderAt('/practice/session');
    expect(await settle(() => el.textContent?.includes('Suggest') ?? false, 400)).toBe(true);

    // The answer is hidden: every character box shows a placeholder.
    const boxes = [...el.querySelectorAll('.word-characters span')].map((s) => s.textContent);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((c) => c === '？')).toBe(true);

    // Pinyin + audio (the question) are always shown in dictation mode.
    expect(el.querySelector('.word-pinyin')?.textContent).toBeTruthy();
    expect(el.querySelector('.audio-btn')).toBeTruthy();

    // Dictation-specific controls, no stroke hints.
    expect(el.textContent).toContain('Show answer');
    expect(el.textContent).toContain('Dictation');
    expect(el.querySelector('[aria-label="Show hint"]')).toBeNull();
    expect(el.querySelector('[aria-label="Clear canvas"]')).toBeTruthy();
  });

  it('shows the not-found page for unknown routes', async () => {
    const el = await renderAt('/definitely-not-a-page');
    expect(el.textContent).toContain('Page not found');
  });
});
