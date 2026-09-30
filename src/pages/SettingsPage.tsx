import { useState } from 'react';
import { Field, Segmented, Slider, Switch } from '../components/ui/Controls';
import { IconSettings, IconVolume, IconTrash } from '../components/ui/Icon';
import { useSpeech } from '../hooks/useSpeech';
import { progressRepo } from '../services/storage/progressRepository';
import { loadSettings } from '../services/storage/settingsStore';
import { useSettings } from '../store/SettingsContext';
import type { DisplayMode, HintMode, PracticeMode, QuizType, Strictness } from '../types';

const DISPLAY_MODES: { value: DisplayMode; label: string; title: string }[] = [
  { value: 'hanzi', label: 'Hanzi', title: 'Only the characters' },
  { value: 'hanzi-pinyin', label: '+ Pinyin', title: 'Characters and pronunciation' },
  { value: 'hanzi-meaning', label: '+ Meaning', title: 'Characters and translation' },
  { value: 'all', label: 'Everything', title: 'Hanzi, pinyin and meaning' },
];

const HINT_MODES: { value: HintMode; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'No hints unless you ask (H)' },
  { value: 'next', label: 'Next stroke', title: 'Always highlight the expected stroke' },
  { value: 'ghost', label: 'Ghost', title: 'Fade the whole character in the box' },
  { value: 'guide', label: 'Guide', title: 'Ghost plus animated stroke order' },
];

const STRICTNESS: { value: Strictness; label: string; title: string }[] = [
  { value: 'lenient', label: 'Lenient', title: 'Forgiving checks — great for beginners' },
  { value: 'normal', label: 'Normal', title: 'Balanced checking' },
  { value: 'strict', label: 'Strict', title: 'Shape, position and order all matter' },
];

const MODES: { value: PracticeMode; label: string }[] = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'random', label: 'Shuffled' },
  { value: 'weak', label: 'Weak words' },
  { value: 'repeat', label: 'Repeat' },
];

const QUIZZES: { value: QuizType; label: string; title: string }[] = [
  { value: 'dictation', label: 'Dictation', title: 'Hear the word, write it from memory' },
  { value: 'strokes', label: 'Stroke order', title: 'See the character, match its strokes' },
];

export function SettingsPage() {
  const { settings, setSection, replace } = useSettings();
  const { voices, chineseVoices, speak, supported } = useSpeech();
  const [resetArmed, setResetArmed] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const voiceOptions = chineseVoices.length ? chineseVoices : voices;

  const testVoice = () => {
    speak('你好，我们开始练习汉字吧');
  };

  const resetProgress = async () => {
    await progressRepo.resetProgress();
    setResetArmed(false);
    setResetDone(true);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Tune how the app looks, sounds and checks your handwriting.</p>
        </div>
      </div>

      <div className="grid grid-2 settings-grid">
        {/* ---------------- appearance ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>
              <IconSettings size={15} /> Appearance
            </h2>
          </div>
          <div className="stack gap-4">
            <Field label="Theme">
              <Segmented
                ariaLabel="Theme"
                value={settings.theme}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                onChange={(theme) => setSection('theme', theme)}
              />
            </Field>

            <Field label="Word display">
              <Segmented
                ariaLabel="Word display"
                value={settings.display.mode}
                options={DISPLAY_MODES}
                onChange={(mode) => setSection('display', { mode })}
              />
            </Field>

            <Field label="Text size" hint="Scales the word shown during practice.">
              <Slider
                label="Text size"
                min={0.8}
                max={1.6}
                step={0.05}
                value={settings.display.fontScale}
                display={`${Math.round(settings.display.fontScale * 100)}%`}
                onChange={(fontScale) => setSection('display', { fontScale })}
              />
            </Field>

            <div className="row gap-3 settings-switch">
              <span className="grow field-label">Grid lines in the writing box</span>
              <Switch
                label="Grid lines"
                checked={settings.display.showGrid}
                onChange={(showGrid) => setSection('display', { showGrid })}
              />
            </div>

            <Field label="Animation speed" hint="Stroke-order guide playback.">
              <Slider
                label="Animation speed"
                min={0.4}
                max={2.5}
                step={0.1}
                value={settings.display.animationSpeed}
                display={`${settings.display.animationSpeed.toFixed(1)}×`}
                onChange={(animationSpeed) => setSection('display', { animationSpeed })}
              />
            </Field>
          </div>
        </section>

        {/* ---------------- practice ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>Practice</h2>
          </div>
          <div className="stack gap-4">
            <Field label="Default order">
              <Segmented
                ariaLabel="Default order"
                value={settings.practice.mode}
                options={MODES}
                onChange={(mode) => setSection('practice', { mode })}
              />
            </Field>

            <Field label="Default quiz" hint="Used by new sessions; each session can switch it.">
              <Segmented
                ariaLabel="Default quiz"
                value={settings.practice.quiz}
                options={QUIZZES}
                onChange={(quiz) => setSection('practice', { quiz })}
              />
            </Field>

            <Field label="Session size" hint="Words per session (repeat mode ignores this).">
              <Slider
                label="Session size"
                min={5}
                max={60}
                step={5}
                value={settings.practice.sessionSize}
                display={`${settings.practice.sessionSize} words`}
                onChange={(sessionSize) => setSection('practice', { sessionSize })}
              />
            </Field>

            <div className="row gap-3 settings-switch">
              <span className="grow field-label">Speak each word automatically</span>
              <Switch
                label="Auto play pronunciation"
                checked={settings.practice.autoPlay}
                onChange={(autoPlay) => setSection('practice', { autoPlay })}
              />
            </div>

            <div className="row gap-3 settings-switch">
              <span className="grow field-label">Advance to the next word after solving</span>
              <Switch
                label="Auto next"
                checked={settings.practice.autoNext}
                onChange={(autoNext) => setSection('practice', { autoNext })}
              />
            </div>

            <Field
              label="Automatic hint"
              hint={
                settings.practice.autoHintAfter === 0
                  ? 'Hints only appear when you press H.'
                  : `Show a hint after ${settings.practice.autoHintAfter} failed ${
                      settings.practice.autoHintAfter === 1 ? 'check' : 'checks'
                    }.`
              }
            >
              <Slider
                label="Automatic hint after failures"
                min={0}
                max={5}
                step={1}
                value={settings.practice.autoHintAfter}
                display={settings.practice.autoHintAfter === 0 ? 'off' : `${settings.practice.autoHintAfter}×`}
                onChange={(autoHintAfter) => setSection('practice', { autoHintAfter })}
              />
            </Field>
          </div>
        </section>

        {/* ---------------- handwriting ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>Handwriting</h2>
          </div>
          <div className="stack gap-4">
            <Field label="Strictness">
              <Segmented
                ariaLabel="Strictness"
                value={settings.handwriting.strictness}
                options={STRICTNESS}
                onChange={(strictness) => setSection('handwriting', { strictness })}
              />
            </Field>

            <Field label="Hints">
              <Segmented
                ariaLabel="Hint style"
                value={settings.handwriting.hintMode}
                options={HINT_MODES}
                onChange={(hintMode) => setSection('handwriting', { hintMode })}
              />
            </Field>

            <Field label="Brush width">
              <Slider
                label="Brush width"
                min={0.02}
                max={0.09}
                step={0.005}
                value={settings.handwriting.brushWidth}
                display={`${(settings.handwriting.brushWidth * 1000).toFixed(0)}`}
                onChange={(brushWidth) => setSection('handwriting', { brushWidth })}
              />
            </Field>

            <Field label="Smoothing" hint="Higher values soften shaky lines.">
              <Slider
                label="Smoothing"
                min={0}
                max={0.7}
                step={0.05}
                value={settings.handwriting.smoothing}
                display={`${Math.round(settings.handwriting.smoothing * 100)}%`}
                onChange={(smoothing) => setSection('handwriting', { smoothing })}
              />
            </Field>
          </div>
        </section>

        {/* ---------------- audio ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>
              <IconVolume size={15} /> Audio
            </h2>
            <span className="hint">{supported ? 'speech synthesis' : 'not supported here'}</span>
          </div>
          <div className="stack gap-4">
            <div className="row gap-3 settings-switch">
              <span className="grow field-label">Pronunciation audio</span>
              <Switch
                label="Audio enabled"
                checked={settings.audio.enabled}
                onChange={(enabled) => setSection('audio', { enabled })}
              />
            </div>

            <Field label="Voice" hint={voiceOptions.length ? undefined : 'No system voices found.'}>
              <select
                className="select"
                value={settings.audio.voiceURI ?? ''}
                onChange={(e) =>
                  setSection('audio', { voiceURI: e.target.value || null })
                }
                aria-label="Voice"
                disabled={!voiceOptions.length}
              >
                <option value="">Automatic (system default)</option>
                {voiceOptions.map((v) => (
                  <option key={v.uri} value={v.uri}>
                    {v.name} — {v.lang}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Speed">
              <Slider
                label="Speech rate"
                min={0.5}
                max={1.6}
                step={0.1}
                value={settings.audio.rate}
                display={`${settings.audio.rate.toFixed(1)}×`}
                onChange={(rate) => setSection('audio', { rate })}
              />
            </Field>

            <Field label="Volume">
              <Slider
                label="Volume"
                min={0}
                max={1}
                step={0.1}
                value={settings.audio.volume}
                display={`${Math.round(settings.audio.volume * 100)}%`}
                onChange={(volume) => setSection('audio', { volume })}
              />
            </Field>

            <button
              className="btn"
              onClick={testVoice}
              disabled={!settings.audio.enabled || !supported}
            >
              <IconVolume size={15} />
              Test voice
            </button>
          </div>
        </section>

        {/* ---------------- data ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>
              <IconTrash size={15} /> Data
            </h2>
          </div>
          <div className="stack gap-3">
            <p className="small muted">
              Your progress lives entirely in this browser (IndexedDB) — nothing is uploaded
              anywhere. Custom word lists are kept when you reset progress.
            </p>
            {resetDone ? (
              <div className="notice" role="status">
                <span className="grow">Progress cleared. Custom lists were kept.</span>
              </div>
            ) : resetArmed ? (
              <div className="row gap-2 wrap">
                <span className="small" style={{ color: 'var(--bad)' }}>
                  Delete all attempts, stats and session history?
                </span>
                <button className="btn btn-sm btn-danger" onClick={() => void resetProgress()}>
                  Yes, erase everything
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setResetArmed(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn btn-danger" onClick={() => setResetArmed(true)}>
                <IconTrash size={15} />
                Reset progress
              </button>
            )}
          </div>
        </section>

        {/* ---------------- about ---------------- */}
        <section className="card card-pad">
          <div className="panel-title">
            <h2>About</h2>
          </div>
          <div className="stack gap-2 small muted">
            <p>
              <strong>Vocabulary</strong> — HSK 2.0 and New HSK 3.0 word lists from{' '}
              <em>drkameleon/complete-hsk-vocabulary</em> (MIT), organised into textbook-style
              lessons by frequency.
            </p>
            <p>
              <strong>Stroke data</strong> — Make Me a Hanzi outlines and medians via{' '}
              <em>hanzi-writer-data</em> (MIT), cached locally after first use.
            </p>
            <button
              className="btn btn-sm"
              onClick={() => replace(loadSettings())}
              title="Re-read stored settings"
            >
              Reload settings
            </button>
          </div>
        </section>
      </div>

      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 24 }}>
        Settings save automatically on this device.
      </p>
    </main>
  );
}
