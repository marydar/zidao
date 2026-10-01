import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandwritingCanvas, type CanvasHandle } from '../components/handwriting/HandwritingCanvas';
import { SessionSummaryView } from '../components/practice/SessionSummary';
import { EmptyState } from '../components/ui/Controls';
import {
  IconBulb,
  IconCheck,
  IconEraser,
  IconEye,
  IconPen,
  IconRefresh,
  IconSearch,
  IconSkip,
  IconUndo,
  IconVolume,
  IconVolumeOff,
  IconX,
} from '../components/ui/Icon';
import { useHotkeys } from '../hooks/useHotkeys';
import { usePracticeSession } from '../hooks/usePracticeSession';
import { formatClock } from '../lib/date';
import { prefetchHcr, recognizeHandwriting, type CharCandidate } from '../services/handwriting/hcr';
import { loadStrokeData } from '../services/handwriting/strokeDataSource';
import { weakReviewSelection } from '../services/vocabulary/queue';
import { useSettings } from '../store/SettingsContext';
import type { HintMode, StrokeData } from '../types';

const MODE_LABEL: Record<string, string> = {
  sequential: 'Sequential order',
  random: 'Shuffled',
  repeat: 'Repeats until you stop',
  weak: 'Weak words first',
};

/** Pause after the last stroke before dictation suggests automatically. */
const AUTO_SUGGEST_DEBOUNCE_MS = 700;

export function SessionPage() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { state, currentWord, currentChar, actions, quiz, speaking } = usePracticeSession();
  const dictation = quiz === 'dictation';

  const canvasRef = useRef<CanvasHandle>(null);
  const autoSuggestTimer = useRef<number | null>(null);
  const [charData, setCharData] = useState<StrokeData | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [hintPulse, setHintPulse] = useState<{ key: string; n: number }>({ key: '', n: 0 });

  /* ---- dictation state ---- */
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<CharCandidate[] | null>(null);
  const [readNotice, setReadNotice] = useState<string | null>(null);

  /* ---- stroke data for the current character ---- */
  useEffect(() => {
    let alive = true;
    if (!currentChar) {
      setCharData(null);
      return;
    }
    setCharData(null);
    void loadStrokeData(currentChar).then((data) => {
      if (alive) setCharData(data);
    });
    return () => {
      alive = false;
    };
  }, [currentChar]);

  /* ---- failed checks clear the canvas so the next attempt starts clean ---- */
  useEffect(() => {
    if (state.feedback?.tone === 'error') canvasRef.current?.clear();
  }, [state.feedback]);

  const charKey = `${state.sessionId}-${state.index}-${state.charIndex}`;

  /* ---- dictation: revealed characters reset per word; a miss reveals this one ---- */
  useEffect(() => {
    setRevealed(new Set());
  }, [state.index]);

  useEffect(() => {
    if (!dictation) return;
    if (state.feedback?.tone === 'error' && !state.locked && !state.wordComplete) {
      setRevealed((prev) =>
        prev.has(state.charIndex) ? prev : new Set(prev).add(state.charIndex),
      );
    }
  }, [dictation, state.feedback, state.charIndex, state.locked, state.wordComplete]);

  /* ---- dictation: suggestions only apply to the drawing they were made from ---- */
  useEffect(() => {
    setSuggestions(null);
    setReadNotice(null);
    if (autoSuggestTimer.current !== null) {
      window.clearTimeout(autoSuggestTimer.current);
      autoSuggestTimer.current = null;
    }
  }, [charKey]);

  /* ---- dictation: warm the recognizer so the first suggest is fast ---- */
  useEffect(() => {
    if (dictation && state.status === 'active') prefetchHcr();
  }, [dictation, state.status]);

  useEffect(
    () => () => {
      if (autoSuggestTimer.current !== null) window.clearTimeout(autoSuggestTimer.current);
    },
    [],
  );

  /* ---- guide playback: once per explicit hint or first auto-hint per char ---- */
  const hintMode = settings.handwriting.hintMode;
  const pulseForChar = hintPulse.key === charKey ? hintPulse.n : 0;
  const guideSignature = `${charKey}:${state.hintVisible ? 1 : 0}:${pulseForChar}`;
  const guidePlayedRef = useRef('');

  const effectiveHintMode: HintMode = dictation ? 'off' : hintMode;

  useEffect(() => {
    if (effectiveHintMode !== 'guide') return;
    const wantsPlay = state.hintVisible || pulseForChar > 0;
    if (!wantsPlay) {
      guidePlayedRef.current = '';
      return;
    }
    if (guidePlayedRef.current === guideSignature) return;
    guidePlayedRef.current = guideSignature;
    canvasRef.current?.playGuide();
  }, [effectiveHintMode, state.hintVisible, pulseForChar, guideSignature]);

  const canvasHint: HintMode = effectiveHintMode === 'off' && state.hintVisible && !dictation ? 'next' : effectiveHintMode;
  const nextStroke =
    !dictation && (state.hintVisible || hintMode === 'next')
      ? state.hintTarget ?? strokeCount + 1
      : null;

  const chars = useMemo(() => (currentWord ? [...currentWord.word] : []), [currentWord]);
  const locked = state.locked || state.wordComplete || state.status !== 'active';

  const displayMode = settings.display.mode;
  // Dictation always shows pinyin + meaning: together with the audio they are the question.
  const showPinyin = dictation || displayMode !== 'hanzi';
  const showMeaning = dictation || displayMode === 'hanzi-meaning' || displayMode === 'all';

  const sessionAccuracy = state.session.attempts
    ? Math.round((state.session.correct / state.session.attempts) * 100)
    : null;
  const progressPct = state.queue.length
    ? Math.round(((state.index + (state.wordComplete ? 1 : 0)) / state.queue.length) * 100)
    : 0;

  const onCheck = () => {
    if (locked || checking) return;
    const strokes = canvasRef.current?.getStrokes() ?? [];
    if (!strokes.length) return;
    setChecking(true);
    void actions.check(strokes).finally(() => setChecking(false));
  };

  /** Surface zi similar to what was drawn; the user picks the one they meant. */
  const onSuggest = async () => {
    if (locked || suggesting || !currentChar) return;
    const strokes = canvasRef.current?.getStrokes() ?? [];
    if (!strokes.length) {
      setReadNotice('Draw the character first.');
      return;
    }
    setSuggesting(true);
    setSuggestions(null);
    setReadNotice(null);
    try {
      const context = [...new Set(state.queue.flatMap((w) => [...w.word]))];
      const result = await recognizeHandwriting(strokes, { context, expected: currentChar });
      if (!result.suggestions.length) {
        setReadNotice(
          result.reason === 'tiny'
            ? 'That mark is too small — draw the full character.'
            : 'No similar characters found — adjust your drawing and try again.',
        );
      } else {
        setSuggestions(result.suggestions);
      }
    } catch {
      setReadNotice('Could not build suggestions — try again.');
    } finally {
      setSuggesting(false);
    }
  };

  /* Debounced auto-suggest: fire with the latest closure, not the one that
     scheduled the timer. */
  const onSuggestRef = useRef(onSuggest);
  onSuggestRef.current = onSuggest;

  const onStrokeChange = (n: number) => {
    setStrokeCount(n);
    if (suggestions) setSuggestions(null);
    if (readNotice) setReadNotice(null);
    if (autoSuggestTimer.current !== null) {
      window.clearTimeout(autoSuggestTimer.current);
      autoSuggestTimer.current = null;
    }
    if (!dictation || locked || n === 0) return;
    autoSuggestTimer.current = window.setTimeout(() => {
      autoSuggestTimer.current = null;
      void onSuggestRef.current();
    }, AUTO_SUGGEST_DEBOUNCE_MS);
  };

  /** The user picked the zi they meant (null = reveal the answer); judge it. */
  const onConfirmDictation = (candidate: string | null) => {
    if (locked) return;
    const strokes = canvasRef.current?.getStrokes() ?? [];
    const score =
      candidate === null ? 0 : suggestions?.find((s) => s.char === candidate)?.score ?? 0;
    setSuggestions(null);
    setReadNotice(null);
    actions.answerDictation({ candidate, score, strokeCount: strokes.length });
  };

  const onHint = () => {
    actions.hint();
    setHintPulse((p) => ({ key: charKey, n: p.n + 1 }));
  };

  const onExit = async () => {
    if (!window.confirm('End this session? Your progress will be saved.')) return;
    await actions.exit();
    navigate('/');
  };

  const onWeakWords = async () => {
    const selection = await weakReviewSelection();
    if (selection) actions.startOver({ selection, label: 'Weak words review' });
    else navigate('/practice');
  };

  useHotkeys(
    {
      ' ': (e) => {
        e.preventDefault();
        actions.replayAudio();
      },
      enter: () => {
        if (dictation) {
          if (suggestions?.length) onConfirmDictation(suggestions[0].char);
          else void onSuggest();
        } else {
          onCheck();
        }
      },
      r: () => canvasRef.current?.clear(),
      h: () => {
        if (!dictation) onHint();
      },
      n: () => actions.next(),
    },
    state.status === 'active',
  );

  /* ------------------------------------------------------------------ */

  if (state.status === 'loading') {
    return (
      <main className="session">
        <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <div className="stack gap-3" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span className="hanzi" style={{ fontSize: 46, color: 'var(--accent)', opacity: 0.75 }}>
              习
            </span>
            <h2>Loading your session…</h2>
            <Link className="btn btn-ghost" to="/practice">
              Back to practice setup
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (state.status === 'error') {
    const none = state.error === 'no-session';
    return (
      <main className="session">
        <div className="page">
          <EmptyState
            title={none ? 'No session in progress' : 'Session could not start'}
            body={
              none
                ? 'Pick a book, lesson or word list to start writing.'
                : state.error
            }
            action={
              <div className="row gap-3" style={{ justifyContent: 'center' }}>
                <Link className="btn btn-primary" to="/practice">
                  Start a session
                </Link>
                <Link className="btn btn-ghost" to="/">
                  Dashboard
                </Link>
              </div>
            }
          />
        </div>
      </main>
    );
  }

  if (state.status === 'complete' && state.summary) {
    return (
      <main className="session">
        <SessionSummaryView
          summary={state.summary}
          onRestart={actions.restart}
          onWeakWords={() => void onWeakWords()}
          onDashboard={() => navigate('/')}
        />
      </main>
    );
  }

  const feedback = state.feedback;

  return (
    <main className="session">
      <header className="session-top">
        <button
          className="icon-btn"
          onClick={() => void onExit()}
          aria-label="End session"
          title="End session"
        >
          <IconX />
        </button>
        <div className="session-source">
          <strong>{state.sourceLabel}</strong>
          <span>
            {state.sourceDetail ?? MODE_LABEL[state.mode] ?? state.mode}
            {dictation ? ' · Dictation' : ''}
          </span>
        </div>

        <div className="session-progress">
          <div className="bar">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <div className="labels">
            <span>
              Word {state.index + 1} / {state.queue.length}
            </span>
            <span>{state.results.length} finished</span>
          </div>
        </div>

        <div className="session-stats">
          <div className="session-stat">
            <b>{sessionAccuracy === null ? '—' : `${sessionAccuracy}%`}</b>
            <span>accuracy</span>
          </div>
          <div className="session-stat">
            <b>{formatClock(state.elapsed)}</b>
            <span>time</span>
          </div>
        </div>
      </header>

      <div className="session-body">
        {/* ---------------- word column ---------------- */}
        <section className="word-area">
          <div
            className="word-characters"
            style={{ ['--font-scale' as string]: settings.display.fontScale }}
          >
            {chars.map((ch, i) => {
              const solved = state.charDone[i];
              const shown = solved || revealed.has(i);
              const cls = solved
                ? 'done'
                : revealed.has(i)
                  ? 'missed'
                  : i === state.charIndex && !state.wordComplete
                    ? 'current'
                    : '';
              return (
                <span key={`${ch}-${i}`} className={cls}>
                  {dictation && !shown ? '？' : ch}
                </span>
              );
            })}
          </div>

          {showPinyin && currentWord?.pinyin ? (
            <div className="row gap-3">
              <span className="word-pinyin">{currentWord.pinyin}</span>
              <button
                className={`audio-btn ${speaking ? 'speaking' : ''}`}
                onClick={actions.replayAudio}
                aria-label="Play pronunciation"
                title="Play pronunciation (Space)"
                disabled={!settings.audio.enabled || (!dictation && !currentWord.pinyin)}
              >
                {settings.audio.enabled ? <IconVolume size={19} /> : <IconVolumeOff size={19} />}
              </button>
            </div>
          ) : null}

          {showMeaning ? <div className="word-meaning">{currentWord?.meaning}</div> : null}

          <div className="word-meta">
            {currentWord?.hsk2 ? <span className="chip">HSK {currentWord.hsk2}</span> : null}
            {currentWord?.hsk3 && !currentWord.hsk2 ? (
              <span className="chip">New HSK {currentWord.hsk3}</span>
            ) : null}
            <span className="chip">
              char {Math.min(state.charIndex + 1, chars.length)} / {chars.length}
            </span>
            {state.wordAttempts > 0 ? (
              <span className={`chip ${state.wordMistakes ? 'bad' : 'ok'}`}>
                {state.wordMistakes} {state.wordMistakes === 1 ? 'mistake' : 'mistakes'}
              </span>
            ) : null}
          </div>
        </section>

        {/* ---------------- canvas column ---------------- */}
        <section className="canvas-area">
          <HandwritingCanvas
            ref={canvasRef}
            character={currentChar ? { character: currentChar, data: charData } : null}
            charKey={charKey}
            hintMode={canvasHint}
            nextStroke={nextStroke}
            brushWidth={settings.handwriting.brushWidth}
            smoothing={settings.handwriting.smoothing}
            showGrid={settings.display.showGrid}
            theme={settings.theme}
            animationSpeed={settings.display.animationSpeed}
            disabled={locked}
            onStrokeChange={onStrokeChange}
          />

          {dictation && suggestions?.length ? (
            <div className="suggest-bar">
              <span className="suggest-label">Similar</span>
              <button
                className="btn btn-primary suggest-main hanzi"
                onClick={() => onConfirmDictation(suggestions[0].char)}
                title="Yes — this is the zi I meant (Enter)"
              >
                {suggestions[0].char}
                <span className="kbd">Enter</span>
              </button>
              {suggestions.slice(1).map((s) => (
                <button
                  key={s.char}
                  className="btn suggest-alt hanzi"
                  onClick={() => onConfirmDictation(s.char)}
                  title="I meant this zi"
                >
                  {s.char}
                </button>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSuggestions(null);
                  canvasRef.current?.clear();
                }}
              >
                Redraw
              </button>
            </div>
          ) : null}

          <div className="canvas-toolbar">
            {state.wordComplete ? (
              <button className="btn btn-primary btn-lg check-btn" onClick={() => actions.next()}>
                {state.index + 1 >= state.queue.length && !state.cycling
                  ? 'Finish session'
                  : 'Next word'}
                <span className="kbd">N</span>
              </button>
            ) : dictation ? (
              <>
                <button
                  className="btn btn-primary btn-lg check-btn"
                  onClick={() => void onSuggest()}
                  disabled={locked || suggesting || strokeCount === 0}
                >
                  <IconSearch size={16} />
                  {suggesting ? 'Finding…' : 'Suggest'}
                  <span className="kbd">Enter</span>
                </button>
                <button
                  className="icon-btn"
                  onClick={() => canvasRef.current?.undo()}
                  aria-label="Undo last stroke"
                  title="Undo stroke"
                  disabled={strokeCount === 0}
                >
                  <IconUndo />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => canvasRef.current?.clear()}
                  aria-label="Clear canvas"
                  title="Clear canvas (R)"
                  disabled={strokeCount === 0}
                >
                  <IconEraser />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => actions.skip()}
                  aria-label="Skip word"
                  title="Skip word"
                >
                  <IconSkip />
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-primary btn-lg check-btn"
                  onClick={onCheck}
                  disabled={locked || checking || strokeCount === 0}
                >
                  <IconCheck size={16} />
                  Check
                  <span className="kbd">Enter</span>
                </button>
                <button
                  className="icon-btn"
                  onClick={() => canvasRef.current?.undo()}
                  aria-label="Undo last stroke"
                  title="Undo stroke"
                  disabled={strokeCount === 0}
                >
                  <IconUndo />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => canvasRef.current?.clear()}
                  aria-label="Clear canvas"
                  title="Clear canvas (R)"
                  disabled={strokeCount === 0}
                >
                  <IconEraser />
                </button>
                <button
                  className={`icon-btn ${state.hintVisible ? 'active' : ''}`}
                  onClick={onHint}
                  aria-label="Show hint"
                  title="Show hint (H)"
                >
                  <IconBulb />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => actions.skip()}
                  aria-label="Skip word"
                  title="Skip word"
                >
                  <IconSkip />
                </button>
              </>
            )}
          </div>

          <div className={`feedback ${feedback?.tone ?? 'info'}`}>
            <div className="fb-icon">
              {feedback?.tone === 'success' ? (
                <IconCheck size={16} />
              ) : feedback?.tone === 'error' ? (
                <IconRefresh size={16} />
              ) : (
                <IconPen size={16} />
              )}
            </div>
            <div className="fb-body">
              <div className="fb-title">
                {feedback?.tone === 'success'
                  ? 'Correct'
                  : feedback?.tone === 'error'
                    ? 'Not quite'
                    : state.wordComplete
                      ? 'Word complete'
                      : dictation
                        ? 'Write the character'
                        : currentChar
                          ? `Write “${currentChar}”`
                          : 'Ready'}
                {feedback ? (
                  <span className="score">{Math.round(feedback.score * 100)}% match</span>
                ) : null}
              </div>
              <div className="fb-msg">
                {feedback?.message ??
                  readNotice ??
                  (state.wordComplete
                    ? state.cycling || state.index + 1 < state.queue.length
                      ? 'Moving on…'
                      : 'Finishing up…'
                    : dictation
                      ? 'Write the character you hear in the box, then tap Suggest.'
                      : 'Draw the character in the box, then check your strokes.')}
              </div>
              {feedback?.issues?.length ? (
                <ul className="fb-issues">
                  {feedback.issues.map((issue, i) => (
                    <li key={`${issue.kind}-${i}`}>{issue.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {dictation ? (
              feedback?.tone === 'error' && !state.wordComplete ? (
                <div className="fb-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => actions.revealAndAdvance()}
                    title="Continue with the next character"
                  >
                    {state.charIndex + 1 >= chars.length ? 'Next word' : 'Next character'}
                  </button>
                </div>
              ) : !feedback && !state.wordComplete && !locked ? (
                <div className="fb-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => onConfirmDictation(null)}
                    title="Reveal the answer"
                  >
                    <IconEye size={14} /> Show answer
                  </button>
                </div>
              ) : null
            ) : feedback?.tone === 'error' ? (
              <div className="fb-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => canvasRef.current?.clear()}
                  title="Clear and try again (R)"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>

          <div className="hotkey-row" aria-hidden="true">
            <span>
              <span className="kbd">Space</span> hear word
            </span>
            <span>
              <span className="kbd">Enter</span> {dictation ? 'suggest' : 'check'}
            </span>
            <span>
              <span className="kbd">R</span> clear
            </span>
            {!dictation ? (
              <span>
                <span className="kbd">H</span> hint
              </span>
            ) : null}
            <span>
              <span className="kbd">N</span> next
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
