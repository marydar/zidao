/**
 * SpeechService — single place that talks to the Web SpeechSynthesis API.
 *
 * Design goals:
 *  - never throw (missing API, blocked autoplay, no Chinese voice …)
 *  - discover voices dynamically (voices may arrive asynchronously)
 *  - only expose voices that actually exist on the user's machine
 */

export interface VoiceOption {
  uri: string;
  name: string;
  lang: string;
}

export interface SpeakOptions {
  voiceURI?: string | null;
  locale?: string;
  rate?: number;
  volume?: number;
  onEnd?: () => void;
  onError?: (reason: string) => void;
}

export type SpeechStatus = 'idle' | 'speaking' | 'unsupported' | 'no-voice';

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

class SpeechService {
  private voices: SpeechSynthesisVoice[] = [];
  private listeners = new Set<() => void>();
  private ready = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor() {
    if (!synth) return;
    const refresh = () => {
      this.voices = synth.getVoices();
      this.ready = this.voices.length > 0;
      this.emit();
    };
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    // Some browsers only populate voices after a tick or a user gesture.
    window.addEventListener('pointerdown', refresh, { once: true });
    setTimeout(refresh, 500);
    setTimeout(refresh, 2000);
  }

  get supported(): boolean {
    return synth !== null;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  getAllVoices(): VoiceOption[] {
    return this.voices.map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  }

  /** Chinese voices, preferring the requested locale. Never invents voices. */
  getChineseVoices(locale = 'zh'): VoiceOption[] {
    const zh = this.voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));
    const prefix = locale.toLowerCase().split('-')[0];
    return zh
      .sort((a, b) => {
        const aMatch = a.lang.toLowerCase().startsWith(prefix) ? 0 : 1;
        const bMatch = b.lang.toLowerCase().startsWith(prefix) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.name.localeCompare(b.name);
      })
      .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang }));
  }

  hasVoices(): boolean {
    return this.ready;
  }

  /** Best-effort voice resolution: exact URI → locale match → any zh voice → null. */
  pickVoice(voiceURI?: string | null, locale = 'zh'): SpeechSynthesisVoice | null {
    if (voiceURI) {
      const exact = this.voices.find((v) => v.voiceURI === voiceURI);
      if (exact) return exact;
    }
    const zh = this.getChineseVoices(locale);
    if (zh.length) {
      const uri = zh[0];
      return this.voices.find((v) => v.voiceURI === uri.uri) ?? null;
    }
    return null;
  }

  speak(text: string, opts: SpeakOptions = {}): void {
    if (!synth) {
      opts.onError?.('Speech synthesis is not supported in this browser.');
      return;
    }
    this.stop();
    if (!text) {
      opts.onEnd?.();
      return;
    }
    if (!this.voices.length) this.voices = synth.getVoices();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.pickVoice(opts.voiceURI, opts.locale);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? opts.locale ?? 'zh-CN';
    utterance.rate = clampRate(opts.rate ?? 1);
    utterance.volume = Math.max(0, Math.min(1, opts.volume ?? 1));
    utterance.onerror = (event) => {
      // "interrupted" happens whenever we cancel — not a real failure.
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        opts.onError?.(`Speech failed (${event.error}).`);
      } else {
        opts.onEnd?.();
      }
      if (this.currentUtterance === utterance) this.currentUtterance = null;
    };
    utterance.onend = () => {
      if (this.currentUtterance === utterance) this.currentUtterance = null;
      opts.onEnd?.();
    };

    this.currentUtterance = utterance;
    try {
      synth.speak(utterance);
      // Chrome occasionally stalls long queues; a resume kick keeps short words alive.
      setTimeout(() => {
        if (synth.paused) synth.resume();
      }, 120);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : 'Speech failed to start.');
      this.currentUtterance = null;
    }
  }

  stop(): void {
    if (!synth) return;
    try {
      synth.cancel();
    } catch {
      /* ignore */
    }
    this.currentUtterance = null;
  }

  isSpeaking(): boolean {
    return this.currentUtterance !== null;
  }
}

function clampRate(rate: number): number {
  return Math.max(0.5, Math.min(2, rate));
}

export const speechService = new SpeechService();
