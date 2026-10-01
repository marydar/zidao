import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ActivityGrid } from '../components/progress/ActivityGrid';
import { EmptyState } from '../components/ui/Controls';
import { IconAward, IconClock, IconTarget, IconTrash, IconTrending } from '../components/ui/Icon';
import { useDayStats, useRecentSessions, useWordStats } from '../hooks/useProgress';
import { dayKey, formatDayLong, formatDuration } from '../lib/date';
import { buildDaySeries, computeOverall, difficultyRows } from '../services/progress/stats';
import { progressRepo } from '../services/storage/progressRepository';
import { getWordsByText } from '../services/vocabulary/vocabularyService';
import type { WordEntry } from '../types';

const TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: 'var(--shadow-2)',
} as const;

export function ProgressPage() {
  const days = useDayStats(3650);
  const wordStats = useWordStats();
  const sessions = useRecentSessions(12);

  const overall = useMemo(() => computeOverall(days, wordStats), [days, wordStats]);
  const series = useMemo(() => buildDaySeries(days, 30), [days]);
  const activitySeries = useMemo(() => buildDaySeries(days, 14), [days]);
  const rows = useMemo(() => difficultyRows(wordStats).slice(0, 14), [wordStats]);

  const [meanings, setMeanings] = useState<Map<string, WordEntry>>(new Map());
  const [clearArmed, setClearArmed] = useState(false);
  const [clearDone, setClearDone] = useState(false);

  const clearHistory = async () => {
    await progressRepo.resetProgress();
    setClearArmed(false);
    setClearDone(true);
  };
  useEffect(() => {
    if (!rows.length) return;
    let alive = true;
    void getWordsByText(rows.map((r) => r.word)).then((words) => {
      if (alive) setMeanings(new Map(words.map((w) => [w.word, w])));
    });
    return () => {
      alive = false;
    };
  }, [rows]);

  const comboData = series.map((p) => ({
    day: p.day,
    label: p.label,
    words: p.words,
    minutes: p.minutes,
    accuracy: p.words ? p.accuracy : null,
  }));

  const hasData = overall.distinctWords > 0 || overall.totalSeconds > 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Progress</h1>
          <p>Everything the app has learned about your handwriting.</p>
        </div>
        <div>
          {clearDone ? (
            <div className="notice" role="status">
              <span>History cleared. Starting fresh.</span>
            </div>
          ) : clearArmed ? (
            <div className="row gap-2 wrap">
              <span className="small" style={{ color: 'var(--bad)' }}>
                Delete all attempts, stats and session history?
              </span>
              <button className="btn btn-sm btn-danger" onClick={() => void clearHistory()}>
                Yes, erase everything
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setClearArmed(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => setClearArmed(true)}>
              <IconTrash size={14} />
              Clear history
            </button>
          )}
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title="No practice recorded yet"
          body="Finish a session and your accuracy, streaks and weak words will show up here."
        />
      ) : (
        <>
          <div className="grid grid-4 stats-row">
            <div className="card stat-card">
              <span className="stat-icon" style={{ color: 'var(--accent)' }}>
                <IconTarget size={16} />
              </span>
              <b className="mono">{Math.round(overall.strokeAccuracy * 100)}%</b>
              <span>Stroke accuracy</span>
              <em className="tiny faint">{overall.attempts} checks</em>
            </div>
            <div className="card stat-card">
              <span className="stat-icon" style={{ color: 'var(--ok)' }}>
                <IconTrending size={16} />
              </span>
              <b className="mono">{Math.round(overall.wordAccuracy * 100)}%</b>
              <span>Clean words</span>
              <em className="tiny faint">{overall.wordTrials} trials</em>
            </div>
            <div className="card stat-card">
              <span className="stat-icon" style={{ color: 'var(--cyan)' }}>
                <IconAward size={16} />
              </span>
              <b className="mono">{Math.round(overall.writingScore * 100)}%</b>
              <span>Writing score</span>
              <em className="tiny faint">{overall.mastered} mastered</em>
            </div>
            <div className="card stat-card">
              <span className="stat-icon" style={{ color: 'var(--warn)' }}>
                <IconClock size={16} />
              </span>
              <b className="mono">{formatDuration(overall.totalSeconds)}</b>
              <span>Total time</span>
              <em className="tiny faint">
                best streak {overall.longestStreak}d
              </em>
            </div>
          </div>

          <section className="section card card-pad">
            <div className="panel-title">
              <h2>
                <IconTrending size={15} /> Last 30 days
              </h2>
              <span className="hint">words per day · accuracy</span>
            </div>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={comboData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-3)' }}
                    itemStyle={{ color: 'var(--text)' }}
                    cursor={{ fill: 'var(--surface-2)' }}
                    formatter={(value, name) => [
                      value,
                      name === 'words' ? 'Words' : 'Accuracy',
                    ]}
                  />
                  <Bar dataKey="words" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Line
                    yAxisId="pct"
                    dataKey="accuracy"
                    stroke="var(--cyan)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-2 section">
            <section className="card card-pad">
              <div className="panel-title">
                <h2>Daily minutes</h2>
                <span className="hint">last 14 days</span>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={190}>
                  <LineChart data={activitySeries} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-3)', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: 'var(--text-3)' }}
                      itemStyle={{ color: 'var(--text)' }}
                      formatter={(value) => [`${value} min`, 'Practice']}
                    />
                    <Line
                      type="monotone"
                      dataKey="minutes"
                      stroke="var(--warn)"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: 'var(--warn)', strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="card card-pad">
              <div className="panel-title">
                <h2>
                  <IconAward size={15} /> Activity
                </h2>
                <span className="hint">{overall.daysActive} active days</span>
              </div>
              <ActivityGrid days={days} weeks={20} />
            </section>
          </div>

          <section className="section card card-pad">
            <div className="panel-title">
              <h2>Trickiest words</h2>
              <span className="hint">ranked by weakness</span>
            </div>
            {rows.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Word</th>
                      <th>Meaning</th>
                      <th className="num">Attempts</th>
                      <th className="num">Accuracy</th>
                      <th className="num">Mistakes</th>
                      <th style={{ width: 130 }}>Weakness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.word}>
                        <td className="hanzi table-word">{r.word}</td>
                        <td className="muted ellipsis">
                          {meanings.get(r.word) ? (
                            <>
                              <span className="faint">{meanings.get(r.word)?.pinyin}</span>{' '}
                              {meanings.get(r.word)?.meaning}
                            </>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="num mono">{r.attempts}</td>
                        <td className="num mono">{Math.round(r.accuracy * 100)}%</td>
                        <td className="num mono">{r.mistakes}</td>
                        <td>
                          <span className="weak-bar">
                            <i
                              style={{
                                width: `${Math.round(r.weakness * 100)}%`,
                                background:
                                  r.weakness > 0.5 ? 'var(--bad)' : r.weakness > 0.25 ? 'var(--warn)' : 'var(--accent)',
                              }}
                            />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small faint">Word-level stats appear after your first session.</p>
            )}
          </section>

          <section className="section card card-pad">
            <div className="panel-title">
              <h2>Session history</h2>
              <span className="hint">latest {sessions.length}</span>
            </div>
            {sessions.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Source</th>
                      <th>Mode</th>
                      <th className="num">Words</th>
                      <th className="num">Strokes</th>
                      <th className="num">Avg score</th>
                      <th className="num">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="muted">{formatDayLong(dayKey(s.startedAt))}</td>
                        <td className="ellipsis">{s.sourceLabel}</td>
                        <td className="faint">{s.mode}</td>
                        <td className="num mono">
                          {s.wordsCorrect}/{s.wordsAttempted}
                        </td>
                        <td className="num mono">
                          {s.correctAttempts}/{s.attempts}
                        </td>
                        <td className="num mono">{Math.round(s.avgScore * 100)}%</td>
                        <td className="num mono">{formatDuration(s.durationSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small faint">No sessions recorded yet.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
