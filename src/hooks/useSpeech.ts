import { useCallback, useEffect, useReducer, useState } from 'react';
import { speechService, type VoiceOption } from '../services/speech/speechService';
import { useSettings } from '../store/SettingsContext';

export interface UseSpeechResult {
  supported: boolean;
  hasChineseVoices: boolean;
  voices: VoiceOption[];
  chineseVoices: VoiceOption[];
  speaking: boolean;
  speak: (text: string) => void;
  /** Speak a vocabulary entry: the characters when a Chinese voice exists, else pinyin. */
  speakWord: (entry: { word: string; pinyin: string }) => void;
  stop: () => void;
}

/** React binding for the SpeechService, wired to user settings. */
export function useSpeech(): UseSpeechResult {
  const { settings } = useSettings();
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => speechService.subscribe(() => tick()), []);

  useEffect(() => () => speechService.stop(), []);

  const speak = useCallback(
    (text: string) => {
      if (!settings.audio.enabled || !text) return;
      setSpeaking(true);
      speechService.speak(text, {
        voiceURI: settings.audio.voiceURI,
        locale: settings.audio.locale,
        rate: settings.audio.rate,
        volume: settings.audio.volume,
        onEnd: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
    },
    [
      settings.audio.enabled,
      settings.audio.voiceURI,
      settings.audio.locale,
      settings.audio.rate,
      settings.audio.volume,
    ],
  );

  const stop = useCallback(() => {
    speechService.stop();
    setSpeaking(false);
  }, []);

  const speakWord = useCallback(
    (entry: { word: string; pinyin: string }) => {
      const hasZh = speechService.getChineseVoices(settings.audio.locale).length > 0;
      if (hasZh && entry.word) speak(entry.word);
      else speak(entry.pinyin || entry.word);
    },
    [speak, settings.audio.locale],
  );

  return {
    supported: speechService.supported,
    voices: speechService.getAllVoices(),
    chineseVoices: speechService.getChineseVoices(settings.audio.locale),
    hasChineseVoices: speechService.getChineseVoices('zh').length > 0,
    speaking,
    speak,
    speakWord,
    stop,
  };
}
