import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, Segmented } from '../components/ui/Controls';
import { IconBook, IconCheck, IconFlame, IconLayers, IconPlay, IconList } from '../components/ui/Icon';
import { useActiveSession, useLists } from '../hooks/useProgress';
import {
  describeSelection,
  getBooksDoc,
  resolveSelection,
} from '../services/vocabulary/vocabularyService';
import { setSessionDraft } from '../services/vocabulary/sessionDraft';
import { weakReviewSelection } from '../services/vocabulary/queue';
import { useSettings } from '../store/SettingsContext';
import type { BookMeta, BooksDoc, PracticeMode, PracticeSelection, QuizType } from '../types';

const MODES: { value: PracticeMode; label: string; note: string }[] = [
  { value: 'sequential', label: 'Sequential', note: 'Book order — steady and predictable.' },
  { value: 'random', label: 'Shuffled', note: 'Queue shuffled once at the start.' },
  { value: 'weak', label: 'Weak words', note: 'Weighted toward words you keep missing.' },
  { value: 'repeat', label: 'Repeat', note: 'Loops until you end the session.' },
];

const QUIZZES: { value: QuizType; label: string; title: string }[] = [
  {
    value: 'dictation',
    label: 'Dictation',
    title: 'Hear the word, then write the hanzi from memory',
  },
  {
    value: 'strokes',
    label: 'Stroke order',
    title: 'See the character and match its strokes',
  },
];

export function PracticeSetupPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { snapshot } = useActiveSession();
  const lists = useLists();

  const [doc, setDoc] = useState<BooksDoc | null>(null);
  const [trackId, setTrackId] = useState('');
  const [bookId, setBookId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<number[]>([]);
  const [listIds, setListIds] = useState<string[]>([]);
  const [mode, setMode] = useState<PracticeMode>(settings.practice.mode);
  const [quiz, setQuiz] = useState<QuizType>(settings.practice.quiz);
  const [previewCount, setPreviewCount] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void getBooksDoc().then((d) => {
      setDoc(d);
      const firstTrack = d.tracks[0];
      if (firstTrack) {
        setTrackId(firstTrack.id);
        const firstBook = d.books.find((b) => firstTrack.bookIds.includes(b.id));
        setBookId(firstBook?.id ?? null);
      }
    });
  }, []);

  const track = doc?.tracks.find((t) => t.id === trackId) ?? null;
  const books = useMemo(
    () => (doc && track ? doc.books.filter((b) => track.bookIds.includes(b.id)) : []),
    [doc, track],
  );
  const book: BookMeta | null = books.find((b) => b.id === bookId) ?? null;

  const selectTrack = (id: string) => {
    const nextTrack = doc?.tracks.find((t) => t.id === id);
    const firstBook = nextTrack ? doc?.books.find((b) => nextTrack.bookIds.includes(b.id)) : null;
    setTrackId(id);
    setBookId(firstBook?.id ?? null);
    setLessons([]);
  };

  const lessonCounts = useMemo(() => {
    const map = new Map<number, number>();
    if (book) {
      book.lessons.forEach((n) => map.set(n, (map.get(n) ?? 0) + 1));
    }
    return map;
  }, [book]);

  const selection: PracticeSelection = useMemo(
    () => ({
      books: bookId ? [{ bookId, lessons: lessons.length ? lessons : undefined }] : [],
      customListIds: listIds.length ? listIds : undefined,
      mode,
      size: settings.practice.sessionSize,
      quiz,
    }),
    [bookId, lessons, listIds, mode, quiz, settings.practice.sessionSize],
  );

  const selectionKey = JSON.stringify(selection);
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      void resolveSelection(JSON.parse(selectionKey) as PracticeSelection).then((words) => {
        if (alive) setPreviewCount(words.length);
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [selectionKey]);

  const canStart = previewCount > 0 && !starting;

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    try {
      const described = await describeSelection(selection);
      setSessionDraft({
        selection,
        label: described.label,
        detail: described.detail ?? `${previewCount} words`,
      });
      navigate('/practice/session');
    } finally {
      setStarting(false);
    }
  };

  const startWeak = async () => {
    const weak = await weakReviewSelection();
    if (weak) {
      setSessionDraft({ selection: { ...weak, quiz }, label: 'Weak words review' });
      navigate('/practice/session');
    }
  };

  const toggleLesson = (n: number) =>
    setLessons((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));

  const toggleList = (id: string) =>
    setListIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Practice</h1>
          <p>Pick what you want to write, then start a session.</p>
        </div>
        <div className="row gap-2 wrap">
          <button className="btn" onClick={() => void startWeak()}>
            <IconFlame size={15} />
            Review weak words
          </button>
        </div>
      </div>

      {snapshot ? (
        <div className="notice setup-resume" role="status">
          <IconPlay size={16} />
          <span className="grow">
            A session on <strong>{snapshot.sourceLabel}</strong> is still in progress (
            {snapshot.results.length} of {snapshot.queue.length} words done).
          </span>
          <Link className="btn btn-sm btn-primary" to="/practice/session">
            Continue
          </Link>
        </div>
      ) : null}

      {!doc ? (
        <div className="section">
          <EmptyState title="Loading vocabulary…" />
        </div>
      ) : (
        <div className="setup-grid">
          {/* ------------- source column ------------- */}
          <div className="stack gap-4">
            <section className="card card-pad">
              <div className="panel-title">
                <h2>
                  <IconBook size={15} /> Course
                </h2>
                <span className="hint">{doc.tracks.map((t) => t.label).join(' · ')}</span>
              </div>

              <Segmented
                ariaLabel="Syllabus track"
                value={trackId}
                options={doc.tracks.map((t) => ({ value: t.id, label: t.label, title: t.note }))}
                onChange={selectTrack}
              />

              <div className="book-list">
                {books.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`book-card ${bookId === b.id ? 'on' : ''}`}
                    onClick={() => {
                      setBookId(bookId === b.id ? null : b.id);
                      setLessons([]);
                    }}
                  >
                    <span className="book-level mono">L{b.level}</span>
                    <span className="book-title">{b.title}</span>
                    <span className="book-meta">
                      {b.words.length} words · {b.lessonCount} lessons
                    </span>
                  </button>
                ))}
                {!books.length ? <p className="tiny faint">No books in this track.</p> : null}
              </div>
            </section>

            {book ? (
              <section className="card card-pad">
                <div className="panel-title">
                  <h2>
                    <IconLayers size={15} /> Lessons
                  </h2>
                  <span className="hint">
                    {lessons.length ? `${lessons.length} selected` : 'whole book'}
                  </span>
                </div>
                <div className="chip-wrap">
                  <button
                    type="button"
                    className={`chip ${lessons.length === 0 ? 'on' : ''}`}
                    onClick={() => setLessons([])}
                  >
                    All
                  </button>
                  {Array.from(lessonCounts.keys())
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`chip ${lessons.includes(n) ? 'on' : ''}`}
                        onClick={() => toggleLesson(n)}
                      >
                        {n}
                        <span className="faint mono tiny">{lessonCounts.get(n)}</span>
                      </button>
                    ))}
                </div>
              </section>
            ) : null}

            <section className="card card-pad">
              <div className="panel-title">
                <h2>
                  <IconList size={15} /> My lists
                </h2>
                <Link className="hint" to="/vocabulary">
                  manage →
                </Link>
              </div>
              {lists.length ? (
                <div className="chip-wrap">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={`chip ${listIds.includes(l.id) ? 'on' : ''}`}
                      onClick={() => toggleList(l.id)}
                    >
                      {l.name}
                      <span className="faint mono tiny">{l.items.length}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="tiny faint">
                  No custom lists yet — build one from the vocabulary browser.
                </p>
              )}
            </section>
          </div>

          {/* ------------- options column ------------- */}
          <div className="stack gap-4">
            <section className="card card-pad">
              <div className="panel-title">
                <h2>Order</h2>
                <span className="hint">{MODES.find((m) => m.value === mode)?.note}</span>
              </div>
              <div className="mode-options">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className={`mode-card ${mode === m.value ? 'on' : ''}`}
                    onClick={() => setMode(m.value)}
                  >
                    <span className="row gap-2">
                      <span className={`radio ${mode === m.value ? 'on' : ''}`} aria-hidden="true" />
                      <strong>{m.label}</strong>
                    </span>
                    <span className="tiny faint">{m.note}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="card card-pad">
              <div className="panel-title">
                <h2>Quiz</h2>
                <span className="hint">{QUIZZES.find((q) => q.value === quiz)?.title}</span>
              </div>
              <Segmented
                ariaLabel="Quiz type"
                value={quiz}
                options={QUIZZES}
                onChange={setQuiz}
              />
            </section>

            <section className="card card-pad start-card">
              <div className="start-stats">
                <div>
                  <b className="mono">{previewCount}</b>
                  <span>words ready</span>
                </div>
                <div>
                  <b className="mono">{settings.practice.sessionSize}</b>
                  <span>per session</span>
                </div>
                <div>
                  <b className="mono">{mode === 'repeat' ? '∞' : '1'}</b>
                  <span>rounds</span>
                </div>
              </div>
              <button
                className="btn btn-primary btn-lg btn-block"
                onClick={() => void start()}
                disabled={!canStart}
              >
                <IconCheck size={16} />
                {previewCount ? 'Start session' : 'Pick a source first'}
              </button>
              {!previewCount ? (
                <p className="tiny faint" style={{ textAlign: 'center' }}>
                  Select a book, lessons or one of your lists.
                </p>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
