import type { SessionSummary } from '../../types';
import { formatDuration } from '../../lib/date';
import { IconAward, IconFlame, IconRefresh, IconTarget, IconTrending } from '../ui/Icon';

interface Props {
  summary: SessionSummary;
  onRestart: () => void;
  onWeakWords: () => void;
  onDashboard: () => void;
}

function pct(x: number): number {
  return Math.round(x * 100);
}

export function SessionSummaryView({ summary, onRestart, onWeakWords, onDashboard }: Props) {
  return (
    <div className="summary">
      <div className="summary-head">
        <div className="big-score">{pct(summary.accuracy)}%</div>
        <h1>Session complete</h1>
        <p>
          {summary.wordsCorrect} of {summary.wordsAttempted} words written cleanly from{' '}
          {summary.sourceLabel}.
        </p>
        {summary.personalBest ? (
          <span className="chip on" style={{ marginTop: 10 }}>
            <IconAward size={13} />
            New personal best
          </span>
        ) : null}
      </div>

      <div className="summary-grid">
        <div className="summary-tile">
          <b>
            {summary.wordsCorrect}/{summary.wordsAttempted}
          </b>
          <span>Clean words</span>
        </div>
        <div className="summary-tile">
          <b>
            {summary.correctAttempts}/{summary.attempts}
          </b>
          <span>Correct strokes</span>
        </div>
        <div className="summary-tile">
          <b>{pct(summary.avgScore)}%</b>
          <span>Writing score</span>
        </div>
        <div className="summary-tile">
          <b>{formatDuration(summary.durationSec)}</b>
          <span>Time</span>
        </div>
      </div>

      <div className="summary-lists">
        {summary.hardest.length ? (
          <div className="summary-list">
            <h3>
              <IconFlame size={13} /> Took the most tries
            </h3>
            <div className="summary-words">
              {summary.hardest.map((h) => (
                <span className="chip bad" key={h.word} title={`${h.mistakes} mistakes`}>
                  <span className="hanzi">{h.word}</span> ×{h.mistakes}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {summary.improved.length ? (
          <div className="summary-list">
            <h3>
              <IconTrending size={13} /> Improved as you went
            </h3>
            <div className="summary-words">
              {summary.improved.map((w) => (
                <span className="chip ok" key={w}>
                  <span className="hanzi">{w}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="summary-list">
          <h3>
            <IconTarget size={13} /> Worth another pass
          </h3>
          <div className="summary-words">
            {summary.review.length ? (
              summary.review.map((w) => (
                <span className="chip" key={w}>
                  <span className="hanzi">{w}</span>
                </span>
              ))
            ) : (
              <span className="tiny faint">Nothing left to review — nice run.</span>
            )}
          </div>
        </div>
      </div>

      <div className="summary-actions">
        <button className="btn btn-primary btn-lg" onClick={onRestart}>
          <IconRefresh size={16} />
          Practice again
        </button>
        <button className="btn btn-lg" onClick={onWeakWords}>
          <IconFlame size={16} />
          Review weak words
        </button>
        <button className="btn btn-ghost btn-lg" onClick={onDashboard}>
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
