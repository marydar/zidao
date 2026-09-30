import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActivityGrid } from '../components/progress/ActivityGrid';
import {
  IconAward,
  IconClock,
  IconFlame,
  IconPen,
  IconPlay,
  IconTarget,
  IconTrending,
} from '../components/ui/Icon';
import { useActiveSession, useDayStats, useRecentSessions, useWordStats } from '../hooks/useProgress';
import { dayKey, formatDayLong, formatDuration, greeting } from '../lib/date';
import { rankedWeakWords, dueForReview } from '../services/adaptive/weakness';
import { computeOverall, computeStreaks } from '../services/progress/stats';
import { setSessionDraft } from '../services/vocabulary/sessionDraft';
import { weakReviewSelection } from '../services/vocabulary/queue';
import { getWordsByText } from '../services/vocabulary/vocabularyService';
import type { WordEntry } from '../types';

export function HomePage() {
  const navigate = useNavigate();
  const days = useDayStats(3650);
  const wordStats = useWordStats();
  const sessions = useRecentSessions(4);
  const { snapshot } = useActiveSession();

  const overall = computeOverall(days, wordStats);
  const streaks = computeStreaks(days);
  const today = days.find((d) => d.day === dayKey());
  const weak = useMemo(() => rankedWeakWords(wordStats).slice(0, 6), [wordStats]);
  const [weakEntries, setWeakEntries] = useState<WordEntry[]>([]);

  useEffect(() => {
    if (!weak.length) {
      setWeakEntries([]);
      return;
    }
    let alive = true;
    void getWordsByText(weak.map((w) => w.word)).then((words) => {
      if (alive) setWeakEntries(words);
    });
    return () => {
      alive = false;
    };
  }, [weak]);

  const meaningFor = (word: string) => weakEntries.find((w) => w.word === word)?.meaning ?? '';

  const startWeak = async () => {
    const selection = await weakReviewSelection();
    if (selection) {
      setSessionDraft({ selection, label: 'Weak words review' });
      navigate('/practice/session');
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}
            {streaks.current > 0 ? `, day ${streaks.current} of your streak` : ''}
          </h1>
          <p>
            {today?.words
              ? `You've written ${today.words} ${today.words === 1 ? 'word' : 'words'} today. Keep it going.`
              : 'A few characters a day is how fluency happens.'}
          </p>
        </div>
        <div className="row gap-2 wrap">
          {snapshot ? (
            <Link className="btn" to="/practice/session">
              <IconPlay size={15} />
              Continue session
            </Link>
          ) : null}
          <button
            className="btn"
            onClick={() => void startWeak()}
            disabled={!overall.distinctWords}
            title={overall.distinctWords ? 'Practice your weakest words' : 'Practice something first'}
          >
            <IconFlame size={15} />
            Weak words
          </button>
          <Link className="btn btn-primary" to="/practice">
            <IconPen size={15} />
            Start practicing
          </Link>
        </div>
      </div>

      <div className="grid grid-4 stats-row">
        <div className="card stat-card">
          <span className="stat-icon" style={{ color: 'var(--accent)' }}>
            <IconTarget size={16} />
          </span>
          <b className="mono">{today?.words ?? 0}</b>
          <span>Words today</span>
          {today?.words ? (
            <em className="tiny faint">
              {Math.round((today.correctWords / today.words) * 100)}% clean
            </em>
          ) : null}
        </div>
        <div className="card stat-card">
          <span className="stat-icon" style={{ color: 'var(--warn)' }}>
            <IconFlame size={16} />
          </span>
          <b className="mono">{streaks.current}</b>
          <span>Day streak</span>
          <em className="tiny faint">best {streaks.longest}</em>
        </div>
        <div className="card stat-card">
          <span className="stat-icon" style={{ color: 'var(--ok)' }}>
            <IconAward size={16} />
          </span>
          <b className="mono">{overall.mastered}</b>
          <span>Words mastered</span>
          <em className="tiny faint">of {overall.distinctWords} practiced</em>
        </div>
        <div className="card stat-card">
          <span className="stat-icon" style={{ color: 'var(--cyan)' }}>
            <IconClock size={16} />
          </span>
          <b className="mono">{formatDuration(overall.totalSeconds)}</b>
          <span>Total practice</span>
          <em className="tiny faint">{overall.daysActive} active days</em>
        </div>
      </div>

      <section className="section card card-pad">
        <div className="panel-title">
          <h2>
            <IconTrending size={15} /> Activity
          </h2>
          <Link className="hint" to="/progress">
            full stats →
          </Link>
        </div>
        <ActivityGrid days={days} weeks={18} />
      </section>

      <div className="grid grid-2 section">
        <section className="card card-pad">
          <div className="panel-title">
            <h2>
              <IconFlame size={15} /> Needs attention
            </h2>
            <span className="hint">hardest first</span>
          </div>
          {weak.length ? (
            <div className="weak-list">
              {weak.map((w) => (
                <div className="weak-row" key={w.word}>
                  <span className="weak-word hanzi">{w.word}</span>
                  <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small muted ellipsis">
                      {meaningFor(w.word) || `practiced ${w.stats.attempts}×`}
                    </span>
                    <span className="weak-bar">
                      <i style={{ width: `${Math.round(w.weakness * 100)}%` }} />
                    </span>
                  </span>
                  <span className="tiny faint mono">
                    {Math.round((w.stats.correct / Math.max(1, w.stats.attempts)) * 100)}%
                  </span>
                  {dueForReview(w.stats) ? <span className="chip bad">due</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="small faint">
              {overall.distinctWords
                ? 'Nothing is struggling right now — your words are in good shape.'
                : 'Practice a few words and weak ones will show up here.'}
            </p>
          )}
        </section>

        <section className="card card-pad">
          <div className="panel-title">
            <h2>Recent sessions</h2>
            <Link className="hint" to="/progress">
              history →
            </Link>
          </div>
          {sessions.length ? (
            <div className="session-list">
              {sessions.map((s) => (
                <div className="session-row" key={s.id}>
                  <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <strong className="ellipsis">{s.sourceLabel}</strong>
                    <span className="tiny faint">
                      {formatDayLong(dayKey(s.startedAt))} · {formatDuration(s.durationSec)} ·{' '}
                      {s.mode}
                    </span>
                  </span>
                  <span className="chip">
                    {s.wordsCorrect}/{s.wordsAttempted}
                  </span>
                  <span
                    className={`chip ${s.wordsAttempted && s.wordsCorrect / s.wordsAttempted >= 0.8 ? 'ok' : ''}`}
                  >
                    {s.wordsAttempted ? Math.round((s.wordsCorrect / s.wordsAttempted) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small faint">No sessions yet — your history will appear here.</p>
          )}
        </section>
      </div>
    </main>
  );
}
