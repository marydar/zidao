import { useEffect, useState } from 'react';
import type { StrokeData } from '../../types';
import { loadStrokeData } from '../../services/handwriting/strokeDataSource';
import { useSettings } from '../../store/SettingsContext';
import { IconPlay } from '../ui/Icon';

interface Props {
  word: string;
  /** Start the animation immediately (word detail modal). */
  autoPlay?: boolean;
}

interface CharBoxState {
  char: string;
  data: StrokeData | null;
  loaded: boolean;
}

/**
 * Stroke-order animation for a whole word: one box per character, each stroke
 * revealed in canonical order (uses normalized pathLength, so outline paths
 * from hanzi-writer-data animate without measuring).
 */
export function StrokeOrderPlayer({ word, autoPlay = false }: Props) {
  const { settings } = useSettings();
  const chars = [...word];
  const [boxes, setBoxes] = useState<CharBoxState[]>([]);
  const [playKey, setPlayKey] = useState(autoPlay ? 1 : 0);

  useEffect(() => {
    setBoxes(chars.map((char) => ({ char, data: null, loaded: false })));
    let alive = true;
    chars.forEach((char, i) => {
      void loadStrokeData(char).then((data) => {
        if (!alive) return;
        setBoxes((prev) => {
          const next = [...prev];
          if (next[i]) next[i] = { ...next[i], data, loaded: true };
          return next;
        });
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  useEffect(() => {
    if (autoPlay) setPlayKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const speed = Math.max(0.25, settings.display.animationSpeed);
  const strokeDur = Math.max(140, 460 / speed);

  return (
    <div className="sop">
      <div className="sop-row">
        {boxes.map(({ char, data, loaded }, boxIndex) => (
          <div className="sop-box" key={`${char}-${boxIndex}`}>
            <svg viewBox="0 0 1024 1024" aria-hidden="true">
              {data?.strokes.map((d, i) => (
                <path
                  key={playKey > 0 ? `${i}-${playKey}` : i}
                  d={d}
                  pathLength={1}
                  className={playKey > 0 ? 'sop-path reveal' : 'sop-path'}
                  style={
                    playKey > 0
                      ? { animationDelay: `${i * strokeDur}ms`, animationDuration: `${strokeDur}ms` }
                      : undefined
                  }
                />
              ))}
            </svg>
            {!loaded ? <span className="sop-loading" aria-hidden="true" /> : null}
            {loaded && !data ? <span className="sop-missing hanzi">{char}</span> : null}
            <span className="sop-caption">
              {data ? `${data.strokes.length} 笔` : loaded ? 'no data' : '…'}
            </span>
          </div>
        ))}
      </div>
      <div className="row gap-3" style={{ justifyContent: 'space-between' }}>
        <span className="tiny faint">
          Strokes appear in the order you should write them.
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setPlayKey((k) => k + 1)}
        >
          <IconPlay size={14} />
          Replay
        </button>
      </div>
    </div>
  );
}
