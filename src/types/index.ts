/** Core domain types shared across the app. */

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export interface WordEntry {
  /** Canonical id — the word itself (stable across sessions/books). */
  word: string;
  pinyin: string;
  meaning: string;
  traditional?: string;
  /** HSK 2.0 level (1–6), if present in the classic syllabus. */
  hsk2?: number;
  /** HSK 3.0 level (1–9), if present in the new syllabus. */
  hsk3?: number;
  frequency?: number;
}

export interface BookMeta {
  id: string;
  track: string;
  level: number;
  title: string;
  count: number;
  lessonCount: number;
  lessonSize: number;
  /** Word texts in practice order (frequency-ranked). */
  words: string[];
  /** Parallel to `words`: 1-based lesson number. */
  lessons: number[];
}

export interface TrackMeta {
  id: string;
  label: string;
  note: string;
  bookIds: string[];
}

export interface BooksDoc {
  source: string;
  generatedAt: string;
  lessonPolicy: string;
  tracks: TrackMeta[];
  books: BookMeta[];
}

export interface CustomListItem {
  word: string;
  pinyin: string;
  meaning: string;
  tags?: string[];
  notes?: string;
}

export interface CustomList {
  id: string;
  name: string;
  items: CustomListItem[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * Practice selection & modes
 * ------------------------------------------------------------------ */

export type PracticeMode = 'sequential' | 'random' | 'repeat' | 'weak';

/** How a character attempt is judged. */
export type QuizType = 'dictation' | 'strokes';

export interface BookSelection {
  bookId: string;
  /** Selected lesson numbers; omitted/empty = whole book. */
  lessons?: number[];
}

export interface PracticeSelection {
  /** Books/lessons to draw from; omit when practising explicit words or lists. */
  books?: BookSelection[];
  customListIds?: string[];
  /** Explicit word subset (intersection with books/lists when both set). */
  words?: string[] | null;
  mode: PracticeMode;
  /** Number of words per session (ignored by `repeat`, which runs until stopped). */
  size?: number;
  /** Quiz style; falls back to the default quiz from settings when omitted. */
  quiz?: QuizType;
}

export type SelectionSummary = {
  label: string;
  detail?: string;
};

/* ------------------------------------------------------------------ *
 * Handwriting
 * ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

/** A stroke drawn by the user, coordinates normalized to 0..1 of the canvas box. */
export interface UserStroke {
  points: Point[];
}

/** Stroke data for one character in the 1024×1024 Make-Me-a-Hanzi coordinate space. */
export interface StrokeData {
  strokes: string[];
  medians: number[][][];
}

export interface HanziCharacter {
  character: string;
  data: StrokeData | null;
}

export type StrokeIssueKind =
  | 'missing'
  | 'extra'
  | 'direction'
  | 'position'
  | 'shape'
  | 'order'
  | 'no-data'
  | 'empty';

export interface StrokeIssue {
  kind: StrokeIssueKind;
  /** 1-based index into the expected strokes (0 for issues without a target stroke). */
  strokeIndex: number;
  message: string;
}

export interface StrokeResult {
  /** 1-based expected stroke number, or null when the user drew an extra stroke. */
  expectedIndex: number | null;
  /** 0-based index into the user's strokes, or null when a stroke is missing. */
  userIndex: number | null;
  /** 0..1 similarity of the matched pair. */
  similarity: number;
  matched: boolean;
  directionReversed: boolean;
}

export interface WritingEvaluation {
  correct: boolean;
  /** 0..1 holistic handwriting quality score. */
  score: number;
  strokeResults: StrokeResult[];
  issues: StrokeIssue[];
  /** Primary human-readable feedback line. */
  feedback: string;
  /** 1-based expected stroke the user should focus on next (null when finished). */
  hintTarget: number | null;
  strokeCount: { expected: number; drawn: number };
  /** True when stroke data was unavailable and a looser fallback was used. */
  fallback: boolean;
}

export interface HanziWritingEvaluator {
  evaluate(strokes: UserStroke[], expected: HanziCharacter): WritingEvaluation;
}

export type Strictness = 'lenient' | 'normal' | 'strict';

/* ------------------------------------------------------------------ *
 * Hints
 * ------------------------------------------------------------------ */

export type HintMode = 'off' | 'next' | 'ghost' | 'guide';

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export interface AttemptRecord {
  id?: number;
  word: string;
  char: string;
  charIndex: number;
  correct: boolean;
  score: number;
  strokeCount: number;
  sessionId: string;
  ts: number;
  day: string;
  ms: number;
}

export interface WordStat {
  word: string;
  /** Number of word-level trials (a trial = one pass through the word's characters). */
  attempts: number;
  correct: number;
  incorrect: number;
  /** Total incorrect character drawings. */
  mistakes: number;
  scoreSum: number;
  scoreCount: number;
  bestScore: number;
  lastAttempt: number;
  firstAttempt: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
}

export interface DayStat {
  /** YYYY-MM-DD in local time. */
  day: string;
  /** Completed word trials. */
  words: number;
  /** Character-level checks. */
  attempts: number;
  /** Correct character-level checks. */
  correct: number;
  /** Word trials solved without a mistake. */
  correctWords: number;
  seconds: number;
  sessions: number;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  sourceLabel: string;
  mode: PracticeMode;
  wordsAttempted: number;
  wordsCorrect: number;
  attempts: number;
  correctAttempts: number;
  avgScore: number;
}

export interface WeakWord {
  word: string;
  weakness: number;
  stats: WordStat;
}

/** Persisted in-progress session so "Continue" can resume after a refresh. */
export interface ActiveSessionSnapshot {
  selection: PracticeSelection;
  sourceLabel: string;
  startedAt: number;
  queue: string[];
  index: number;
  results: SessionWordResult[];
  hintMode: HintMode;
}

export interface SessionWordResult {
  word: string;
  attempts: number;
  correctAttempts: number;
  mistakes: number;
  correct: boolean;
  scoreSum: number;
  scoreCount: number;
  skipped: boolean;
}

export interface ProgressRepository {
  recordAttempt(rec: Omit<AttemptRecord, 'id' | 'day'>): Promise<void>;
  recordWordTrial(trial: {
    word: string;
    correct: boolean;
    /** Incorrect character checks during this trial. */
    mistakes: number;
    attempts: number;
    scoreSum: number;
    scoreCount: number;
    ts: number;
  }): Promise<void>;
  getWordStats(): Promise<Map<string, WordStat>>;
  getDayStats(fromMs: number, toMs: number): Promise<DayStat[]>;
  getRecentSessions(limit: number): Promise<SessionRecord[]>;
  finishSession(rec: SessionRecord): Promise<void>;
  getWeakWords(limit: number): Promise<WeakWord[]>;
  saveActiveSession(snap: ActiveSessionSnapshot | null): Promise<void>;
  loadActiveSession(): Promise<ActiveSessionSnapshot | null>;
}

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

export type FeedbackTone = 'success' | 'error' | 'info';

export interface CharFeedback {
  tone: FeedbackTone;
  score: number;
  message: string;
  issues: StrokeIssue[];
}

export interface SessionSummary {
  wordsAttempted: number;
  wordsCorrect: number;
  attempts: number;
  correctAttempts: number;
  accuracy: number;
  avgScore: number;
  durationSec: number;
  hardest: { word: string; mistakes: number }[];
  improved: string[];
  review: string[];
  sourceLabel: string;
  mode: PracticeMode;
  startedAt: number;
  personalBest: boolean;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export type DisplayMode = 'hanzi' | 'hanzi-pinyin' | 'hanzi-meaning' | 'all';

export interface Settings {
  version: number;
  theme: 'dark' | 'light';
  display: {
    mode: DisplayMode;
    fontScale: number;
    showGrid: boolean;
    animationSpeed: number;
  };
  practice: {
    mode: PracticeMode;
    sessionSize: number;
    autoPlay: boolean;
    autoNext: boolean;
    /** Enable the hint automatically after N failed checks on a character. */
    autoHintAfter: number;
    /** Default quiz style for new sessions. */
    quiz: QuizType;
  };
  audio: {
    enabled: boolean;
    voiceURI: string | null;
    locale: string;
    rate: number;
    volume: number;
  };
  handwriting: {
    /** Brush width as a fraction of the canvas side. */
    brushWidth: number;
    smoothing: number;
    strictness: Strictness;
    hintMode: HintMode;
  };
}
