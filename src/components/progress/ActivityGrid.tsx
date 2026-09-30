import type { DayStat } from '../../types';
import { formatDayLong, startOfDay } from '../../lib/date';

interface Props {
  days: DayStat[];
  /** Number of calendar weeks to display (columns). */
  weeks?: number;
}

function levelFor(words: number): number {
  if (words <= 0) return 0;
  if (words < 5) return 1;
  if (words < 12) return 2;
  if (words < 25) return 3;
  return 4;
}

/** GitHub-style contribution grid of daily practice activity. */
export function ActivityGrid({ days, weeks = 20 }: Props) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = startOfDay();
  const todayDow = new Date(today).getDay();

  // The grid ends with the current week; each column is a Sunday→Saturday week.
  const lastWeekStart = today - todayDow * 86_400_000;
  const firstWeekStart = lastWeekStart - (weeks - 1) * 7 * 86_400_000;

  const cells: { key: string; day: string; stat?: DayStat; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const t = firstWeekStart + i * 86_400_000;
    const localDay = toLocalDay(t);
    const future = t > today;
    cells.push({ key: localDay, day: localDay, stat: byDay.get(localDay), future });
  }

  return (
    <div className="activity">
      <div className="act-grid" role="img" aria-label="Practice activity over the last weeks">
        {cells.map((c) => {
          const words = c.stat?.words ?? 0;
          const minutes = c.stat ? Math.round(c.stat.seconds / 60) : 0;
          const title = c.future
            ? ''
            : `${formatDayLong(c.day)} — ${words} ${words === 1 ? 'word' : 'words'}${
                minutes ? `, ${minutes} min` : ''
              }${c.stat?.sessions ? `, ${c.stat.sessions} session${c.stat.sessions > 1 ? 's' : ''}` : ''}`;
          return (
            <span
              key={c.key}
              className={`act-cell ${c.future ? 'future' : `l${levelFor(words)}`}`}
              title={title}
            />
          );
        })}
      </div>
      <div className="act-legend">
        <span className="tiny faint">Less</span>
        <span className="act-cell l0" />
        <span className="act-cell l1" />
        <span className="act-cell l2" />
        <span className="act-cell l3" />
        <span className="act-cell l4" />
        <span className="tiny faint">More</span>
      </div>
    </div>
  );
}

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
