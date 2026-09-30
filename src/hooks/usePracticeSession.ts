import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  CharFeedback,
  PracticeMode,
  PracticeSelection,
  QuizType,
  SessionSummary,
  SessionWordResult,
  UserStroke,
  WordEntry,
  WritingEvaluation,
} from '../types';
import { getEvaluator } from '../services/handwriting/evaluator';
import { loadStrokeData, preloadStrokes } from '../services/handwriting/strokeDataSource';
import { buildQueue } from '../services/vocabulary/queue';
import { getWordsByText } from '../services/vocabulary/vocabularyService';
import { getSessionDraft, setSessionDraft, type SessionDraft } from '../services/vocabulary/sessionDraft';
import { progressRepo } from '../services/storage/progressRepository';
import { useSettings } from '../store/SettingsContext';
import { useSpeech } from './useSpeech';
import { uid } from '../lib/date';

export type SessionStatus = 'loading' | 'active' | 'complete' | 'error';

interface State {
  status: SessionStatus;
  error: string;
  sessionId: string;
  selection: PracticeSelection | null;
  sourceLabel: string;
  sourceDetail?: string;
  mode: PracticeMode;
  cycling: boolean;
  queue: WordEntry[];
  index: number;
  charIndex: number;
  charDone: boolean[];
  locked: boolean;
  wordComplete: boolean;
  wordAttempts: number;
  wordCorrectAttempts: number;
  wordMistakes: number;
  wordScoreSum: number;
  charAttempts: number;
  results: SessionWordResult[];
  session: { attempts: number; correct: number; scoreSum: number };
  feedback: CharFeedback | null;
  hintVisible: boolean;
  hintTarget: number | null;
  startedAt: number;
  elapsed: number;
  summary: SessionSummary | null;
}

const initialState: State = {
  status: 'loading',
  error: '',
  sessionId: '',
  selection: null,
  sourceLabel: '',
  mode: 'sequential',
  cycling: false,
  queue: [],
  index: 0,
  charIndex: 0,
  charDone: [],
  locked: false,
  wordComplete: false,
  wordAttempts: 0,
  wordCorrectAttempts: 0,
  wordMistakes: 0,
  wordScoreSum: 0,
  charAttempts: 0,
  results: [],
  session: { attempts: 0, correct: 0, scoreSum: 0 },
  feedback: null,
  hintVisible: false,
  hintTarget: null,
  startedAt: 0,
  elapsed: 0,
  summary: null,
};

type Action =
  | {
      type: 'loaded';
      queue: WordEntry[];
      selection: PracticeSelection;
      label: string;
      detail?: string;
      mode: PracticeMode;
      cycling: boolean;
      startedAt: number;
      results: SessionWordResult[];
      index: number;
      sessionId: string;
    }
  | { type: 'failed'; message: string }
  | { type: 'checked'; evaluation: WritingEvaluation }
  | { type: 'advanceChar' }
  | { type: 'wordDone'; correct: boolean; skipped: boolean; result: SessionWordResult }
  | { type: 'nextWord' }
  | { type: 'hint'; target: number | null }
  | { type: 'tick'; elapsed: number }
  | { type: 'complete'; summary: SessionSummary }
  | { type: 'reset' };

function charsOf(word: WordEntry): string[] {
  return [...word.word];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        status: 'active',
        queue: action.queue,
        selection: action.selection,
        sourceLabel: action.label,
        sourceDetail: action.detail,
        mode: action.mode,
        cycling: action.cycling,
        startedAt: action.startedAt,
        results: action.results,
        index: action.index,
        sessionId: action.sessionId,
        elapsed: 0,
        // Rebuild session totals from restored results when resuming.
        session: action.results.reduce(
          (acc, r) => ({
            attempts: acc.attempts + r.attempts,
            correct: acc.correct + r.correctAttempts,
            scoreSum: acc.scoreSum + r.scoreSum,
          }),
          { attempts: 0, correct: 0, scoreSum: 0 },
        ),
      };
    case 'failed':
      return { ...state, status: 'error', error: action.message };
    case 'checked': {
      if (state.locked || state.wordComplete) return state;
      const evaluation = action.evaluation;
      const correct = evaluation.correct;
      const charDone = [...state.charDone];
      if (correct) charDone[state.charIndex] = true;
      return {
        ...state,
        charDone,
        wordAttempts: state.wordAttempts + 1,
        wordCorrectAttempts: state.wordCorrectAttempts + (correct ? 1 : 0),
        wordMistakes: state.wordMistakes + (correct ? 0 : 1),
        wordScoreSum: state.wordScoreSum + evaluation.score,
        charAttempts: state.charAttempts + 1,
        session: {
          attempts: state.session.attempts + 1,
          correct: state.session.correct + (correct ? 1 : 0),
          scoreSum: state.session.scoreSum + evaluation.score,
        },
        feedback: {
          tone: correct ? 'success' : 'error',
          score: evaluation.score,
          message: evaluation.feedback,
          issues: evaluation.issues.slice(0, 3),
        },
        hintTarget: evaluation.hintTarget,
        hintVisible: correct ? false : state.hintVisible,
        locked: correct,
      };
    }
    case 'advanceChar': {
      const word = state.queue[state.index];
      if (!word) return state;
      if (state.charIndex + 1 >= charsOf(word).length) return state;
      return {
        ...state,
        charIndex: state.charIndex + 1,
        charAttempts: 0,
        locked: false,
        feedback: null,
        hintVisible: false,
        hintTarget: null,
      };
    }
    case 'wordDone': {
      if (state.wordComplete) return state;
      return {
        ...state,
        results: [...state.results, action.result],
        wordComplete: true,
        locked: true,
        hintVisible: false,
        feedback: action.skipped ? null : state.feedback,
      };
    }
    case 'nextWord': {
      let next = state.index + 1;
      if (next >= state.queue.length) {
        if (!state.cycling) return state;
        next = 0;
      }
      return {
        ...state,
        index: next,
        charIndex: 0,
        charDone: [],
        charAttempts: 0,
        locked: false,
        wordComplete: false,
        wordAttempts: 0,
        wordCorrectAttempts: 0,
        wordMistakes: 0,
        wordScoreSum: 0,
        feedback: null,
        hintVisible: false,
        hintTarget: null,
      };
    }
    case 'hint':
      return { ...state, hintVisible: true, hintTarget: action.target ?? state.hintTarget };
    case 'tick':
      return { ...state, elapsed: action.elapsed };
    case 'complete':
      return { ...state, status: 'complete', summary: action.summary, wordComplete: true };
    case 'reset':
      return { ...initialState };
    default:
      return state;
  }
}

export interface SessionActions {
  check(strokes: UserStroke[]): Promise<void>;
  /** Dictation: submit the chosen zi (null = reveal the answer). */
  answerDictation(result: DictationAnswer): void;
  /** Dictation: after a miss, reveal the character and move to the next one. */
  revealAndAdvance(): void;
  hint(): void;
  skip(): void;
  next(): void;
  exit(): Promise<void>;
  replayAudio(): void;
  /** Start over with the same selection (used by the summary screen). */
  restart(): void;
  /** Drop the current session and start a brand new one from a draft. */
  startOver(draft: SessionDraft): void;
}

export interface DictationAnswer {
  /** The zi the user picked as what they meant, or null when giving up. */
  candidate: string | null;
  /** 0..1 similarity of the drawing to the picked zi. */
  score: number;
  /** How many strokes the user drew. */
  strokeCount: number;
}

export interface PracticeSession {
  state: State;
  currentWord: WordEntry | null;
  currentChar: string | null;
  actions: SessionActions;
  /** Quiz style for this session (dictation vs stroke-check). */
  quiz: QuizType;
  /** True while the shared speech service is speaking (audio button pulse). */
  speaking: boolean;
}

export function usePracticeSession(): PracticeSession {
  const { settings } = useSettings();
  const speech = useSpeech();
  const speakWord = speech.speakWord;
  const [state, dispatch] = useReducer(reducer, initialState);
  const [initKey, setInitKey] = useState(0);
  const timersRef = useRef<number[]>([]);
  const charStartRef = useRef(Date.now());
  const finalizingRef = useRef(false);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const speakRef = useRef(speakWord);
  speakRef.current = speakWord;

  /* ---------------- initialization (new session or resume) ---------------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const draft = getSessionDraft();
        setSessionDraft(null);
        if (draft) {
          const stats = await progressRepo.getWordStats();
          const size = settingsRef.current.practice.sessionSize;
          const { words, mode, cycling } = await buildQueue(draft.selection, stats, size);
          if (!alive) return;
          if (!words.length) {
            dispatch({
              type: 'failed',
              message: 'That selection has no vocabulary. Pick a book, lesson or list first.',
            });
            return;
          }
          dispatch({
            type: 'loaded',
            queue: words,
            selection: draft.selection,
            label: draft.label,
            detail: draft.detail,
            mode,
            cycling,
            startedAt: Date.now(),
            results: [],
            index: 0,
            sessionId: uid('sess-'),
          });
          return;
        }

        const snap = await progressRepo.loadActiveSession();
        if (!alive) return;
        if (!snap) {
          dispatch({ type: 'failed', message: 'no-session' });
          return;
        }
        const words = await getWordsByText(snap.queue);
        if (!alive) return;
        const resumeIndex = Math.max(snap.index, snap.results.length);
        if (!words.length || resumeIndex >= snap.queue.length) {
          await progressRepo.saveActiveSession(null);
          if (alive) dispatch({ type: 'failed', message: 'no-session' });
          return;
        }
        dispatch({
          type: 'loaded',
          queue: words,
          selection: snap.selection,
          label: snap.sourceLabel,
          mode: snap.selection.mode,
          cycling: snap.selection.mode === 'repeat' || snap.selection.mode === 'weak',
          startedAt: snap.startedAt,
          results: snap.results,
          index: resumeIndex,
          sessionId: uid('sess-'),
        });
      } catch (err) {
        if (alive) {
          dispatch({
            type: 'failed',
            message: err instanceof Error ? err.message : 'Could not start the session.',
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [initKey]);

  /* ---------------- derived values ---------------- */

  const currentWord = state.queue[state.index] ?? null;
  const currentChar = currentWord ? charsOf(currentWord)[state.charIndex] ?? null : null;
  const quiz: QuizType = state.selection?.quiz ?? settings.practice.quiz;

  /* ---------------- audio + stroke preloading ---------------- */

  useEffect(() => {
    if (state.status !== 'active' || !currentWord) return;
    preloadStrokes(charsOf(currentWord));
    const next = state.queue[state.index + 1];
    if (next) preloadStrokes(charsOf(next));
    if (settings.practice.autoPlay && (currentWord.word || currentWord.pinyin)) {
      speakRef.current(currentWord);
    }
    charStartRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, state.status]);

  /* ---------------- autosave (resume support) ---------------- */

  useEffect(() => {
    if (state.status !== 'active' || !state.selection) return;
    void progressRepo.saveActiveSession({
      selection: state.selection,
      sourceLabel: state.sourceLabel,
      startedAt: state.startedAt,
      queue: state.queue.map((w) => w.word),
      index: state.index,
      results: state.results,
      hintMode: settingsRef.current.handwriting.hintMode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index, state.results, state.status]);

  /* ---------------- timer ---------------- */

  useEffect(() => {
    if (state.status !== 'active') return;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (s.startedAt) dispatch({ type: 'tick', elapsed: Math.floor((Date.now() - s.startedAt) / 1000) });
    }, 1000);
    return () => clearInterval(id);
  }, [state.status]);

  /* ---------------- session finalization ---------------- */

  const buildSummary = useCallback((s: State, personalBest: boolean): SessionSummary => {
    const wordsAttempted = s.results.length;
    const wordsCorrect = s.results.filter((r) => r.correct).length;
    const hardest = [...s.results]
      .filter((r) => r.mistakes > 0)
      .sort((a, b) => b.mistakes - a.mistakes)
      .slice(0, 6)
      .map((r) => ({ word: r.word, mistakes: r.mistakes }));
    const improved = s.results.filter((r) => r.mistakes > 0 && r.correct).map((r) => r.word);
    const review = s.results.filter((r) => !r.correct).map((r) => r.word);
    return {
      wordsAttempted,
      wordsCorrect,
      attempts: s.session.attempts,
      correctAttempts: s.session.correct,
      accuracy: wordsAttempted ? wordsCorrect / wordsAttempted : 0,
      avgScore: s.session.attempts ? s.session.scoreSum / s.session.attempts : 0,
      durationSec: Math.max(1, Math.round((Date.now() - s.startedAt) / 1000)),
      hardest,
      improved,
      review,
      sourceLabel: s.sourceLabel,
      mode: s.mode,
      startedAt: s.startedAt,
      personalBest,
    };
  }, []);

  const finalize = useCallback(
    async (toSummary: boolean) => {
      const s = stateRef.current;
      if (finalizingRef.current) return;
      finalizingRef.current = true;
      clearTimers();
      try {
        const wordsAttempted = s.results.length;
        const wordsCorrect = s.results.filter((r) => r.correct).length;
        const accuracy = wordsAttempted ? wordsCorrect / wordsAttempted : 0;
        const personalBest =
          wordsAttempted >= 8 ? await progressRepo.considerBestAccuracy(accuracy, wordsAttempted) : false;
        await progressRepo.finishSession({
          id: s.sessionId || uid('sess-'),
          startedAt: s.startedAt || Date.now(),
          endedAt: Date.now(),
          durationSec: Math.max(1, Math.round((Date.now() - (s.startedAt || Date.now())) / 1000)),
          sourceLabel: s.sourceLabel || 'Practice',
          mode: s.mode,
          wordsAttempted,
          wordsCorrect,
          attempts: s.session.attempts,
          correctAttempts: s.session.correct,
          avgScore: s.session.attempts ? s.session.scoreSum / s.session.attempts : 0,
        });
        await progressRepo.saveActiveSession(null);
        setSessionDraft(null);
        if (toSummary) dispatch({ type: 'complete', summary: buildSummary(s, personalBest) });
      } finally {
        finalizingRef.current = false;
      }
    },
    [buildSummary, clearTimers],
  );

  const completeWord = useCallback(
    async (opts: { skipped: boolean }) => {
      const s = stateRef.current;
      const word = s.queue[s.index];
      if (!word || s.wordComplete) return;
      const correct = !opts.skipped && s.wordMistakes === 0 && s.charDone.every(Boolean);
      const result: SessionWordResult = {
        word: word.word,
        attempts: s.wordAttempts,
        correctAttempts: s.wordCorrectAttempts,
        mistakes: s.wordMistakes,
        correct,
        scoreSum: s.wordScoreSum,
        scoreCount: s.wordAttempts,
        skipped: opts.skipped,
      };
      dispatch({ type: 'wordDone', correct, skipped: opts.skipped, result });
      if (s.wordAttempts > 0) {
        await progressRepo.recordWordTrial({
          word: word.word,
          correct,
          mistakes: s.wordMistakes,
          attempts: s.wordAttempts,
          scoreSum: s.wordScoreSum,
          scoreCount: s.wordAttempts,
          ts: Date.now(),
        });
      }

      const isLast = s.index >= s.queue.length - 1;
      if (isLast && !s.cycling) {
        schedule(() => void finalize(true), opts.skipped ? 250 : 850);
      } else if (!opts.skipped && !settingsRef.current.practice.autoNext) {
        // Wait for the user to press N / "Next word".
      } else {
        schedule(() => dispatch({ type: 'nextWord' }), opts.skipped ? 120 : 950);
      }
    },
    [finalize, schedule],
  );

  /* ---------------- actions ---------------- */

  const check = useCallback(
    async (strokes: UserStroke[]) => {
      const s = stateRef.current;
      const word = s.queue[s.index];
      if (!word || s.locked || s.wordComplete || !strokes.length) return;
      const char = charsOf(word)[s.charIndex];
      if (!char) return;
      const data = await loadStrokeData(char);
      const evaluator = getEvaluator(settingsRef.current.handwriting.strictness);
      const evaluation = evaluator.evaluate(strokes, { character: char, data });
      const attemptsAfter = s.charAttempts + 1;

      dispatch({ type: 'checked', evaluation });

      void progressRepo.recordAttempt({
        word: word.word,
        char,
        charIndex: s.charIndex,
        correct: evaluation.correct,
        score: evaluation.score,
        strokeCount: evaluation.strokeCount.drawn,
        sessionId: s.sessionId,
        ts: Date.now(),
        ms: Math.max(200, Date.now() - charStartRef.current),
      });

      const chars = charsOf(word);
      if (evaluation.correct) {
        charStartRef.current = Date.now();
        if (s.charIndex + 1 < chars.length) {
          schedule(() => {
            dispatch({ type: 'advanceChar' });
            charStartRef.current = Date.now();
          }, 680);
        } else {
          schedule(() => void completeWord({ skipped: false }), 880);
        }
      } else {
        const autoAfter = settingsRef.current.practice.autoHintAfter;
        if (autoAfter > 0 && attemptsAfter >= autoAfter) {
          schedule(() => dispatch({ type: 'hint', target: evaluation.hintTarget }), 500);
        }
      }
    },
    [completeWord, schedule],
  );

  const hint = useCallback(() => {
    const s = stateRef.current;
    dispatch({ type: 'hint', target: s.hintTarget ?? 1 });
  }, []);

  /**
   * Dictation judge: compares the confirmed candidate with the expected
   * character. A correct confirmation locks and advances like a normal check;
   * a wrong one stays put until the user redraws or reveals the answer.
   */
  const answerDictation = useCallback(
    (result: DictationAnswer) => {
      const s = stateRef.current;
      const word = s.queue[s.index];
      if (!word || s.locked || s.wordComplete) return;
      const char = charsOf(word)[s.charIndex];
      if (!char) return;
      const correct = result.candidate === char;
      const message =
        result.candidate === null
          ? `The answer is “${char}”.`
          : correct
            ? `Yes — “${char}” is right.`
            : `You picked “${result.candidate}” — the answer is “${char}”.`;
      const evaluation: WritingEvaluation = {
        correct,
        score: correct ? Math.max(result.score, 0.4) : result.score,
        strokeResults: [],
        issues: [],
        feedback: message,
        hintTarget: null,
        strokeCount: { expected: 0, drawn: result.strokeCount },
        fallback: false,
      };

      dispatch({ type: 'checked', evaluation });

      void progressRepo.recordAttempt({
        word: word.word,
        char,
        charIndex: s.charIndex,
        correct,
        score: evaluation.score,
        strokeCount: result.strokeCount,
        sessionId: s.sessionId,
        ts: Date.now(),
        ms: Math.max(300, Date.now() - charStartRef.current),
      });

      if (correct) {
        const chars = charsOf(word);
        charStartRef.current = Date.now();
        if (s.charIndex + 1 < chars.length) {
          schedule(() => {
            dispatch({ type: 'advanceChar' });
            charStartRef.current = Date.now();
          }, 900);
        } else {
          schedule(() => void completeWord({ skipped: false }), 1050);
        }
      }
    },
    [completeWord, schedule],
  );

  /** Reveal the missed character and continue (dictation only). */
  const revealAndAdvance = useCallback(() => {
    const s = stateRef.current;
    const word = s.queue[s.index];
    if (!word || s.wordComplete || s.locked) return;
    if (s.charIndex + 1 >= charsOf(word).length) {
      void completeWord({ skipped: false });
    } else {
      dispatch({ type: 'advanceChar' });
      charStartRef.current = Date.now();
    }
  }, [completeWord]);

  const skip = useCallback(() => {
    const s = stateRef.current;
    if (s.wordComplete) {
      const isLast = s.index >= s.queue.length - 1;
      if (isLast && !s.cycling) void finalize(true);
      else dispatch({ type: 'nextWord' });
      return;
    }
    if (s.wordAttempts > 0) void completeWord({ skipped: true });
    else {
      const isLast = s.index >= s.queue.length - 1;
      if (isLast && !s.cycling) void finalize(true);
      else dispatch({ type: 'nextWord' });
    }
  }, [completeWord, finalize]);

  const next = useCallback(() => {
    const s = stateRef.current;
    if (s.wordComplete) {
      const isLast = s.index >= s.queue.length - 1;
      if (isLast && !s.cycling) void finalize(true);
      else dispatch({ type: 'nextWord' });
    } else {
      skip();
    }
  }, [finalize, skip]);

  const exit = useCallback(async () => {
    const s = stateRef.current;
    if (s.status === 'active' && !s.wordComplete && s.wordAttempts > 0) {
      await completeWord({ skipped: true });
    }
    await finalize(false);
  }, [completeWord, finalize]);

  const replayAudio = useCallback(() => {
    const word = stateRef.current.queue[stateRef.current.index];
    if (word) speakRef.current(word);
  }, []);

  const startOver = useCallback(
    (draft: SessionDraft) => {
      setSessionDraft(draft);
      clearTimers();
      finalizingRef.current = false;
      dispatch({ type: 'reset' });
      setInitKey((k) => k + 1);
    },
    [clearTimers],
  );

  const restart = useCallback(() => {
    const s = stateRef.current;
    if (!s.selection) return;
    startOver({ selection: s.selection, label: s.sourceLabel, detail: s.sourceDetail });
  }, [startOver]);

  const actions = useMemo<SessionActions>(
    () => ({ check, answerDictation, revealAndAdvance, hint, skip, next, exit, replayAudio, restart, startOver }),
    [check, answerDictation, revealAndAdvance, hint, skip, next, exit, replayAudio, restart, startOver],
  );

  return { state, currentWord, currentChar, actions, quiz, speaking: speech.speaking };
}
