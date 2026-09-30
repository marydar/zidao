import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ActiveSessionSnapshot, CustomList, DayStat, SessionRecord, WordStat } from '../types';
import { progressRepo } from '../services/storage/progressRepository';
import { listRepo } from '../services/vocabulary/listRepository';

/** Re-render when any progress mutation happens. */
export function useProgressVersion(): number {
  return useSyncExternalStore(
    (cb) => progressRepo.subscribe(cb),
    () => progressRepo.getVersion(),
    () => 0,
  );
}

export function useWordStats(): Map<string, WordStat> {
  const version = useProgressVersion();
  const [stats, setStats] = useState<Map<string, WordStat>>(() => new Map());
  useEffect(() => {
    let alive = true;
    void progressRepo.getWordStats().then((m) => {
      if (alive) setStats(new Map(m));
    });
    return () => {
      alive = false;
    };
  }, [version]);
  return stats;
}

export function useDayStats(rangeDays = 180): DayStat[] {
  const version = useProgressVersion();
  const [days, setDays] = useState<DayStat[]>([]);
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    void progressRepo
      .getDayStats(now - rangeDays * 86_400_000, now + 86_400_000)
      .then((rows) => {
        if (alive) setDays(rows);
      });
    return () => {
      alive = false;
    };
  }, [rangeDays, version]);
  return days;
}

export function useRecentSessions(limit = 8): SessionRecord[] {
  const version = useProgressVersion();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void progressRepo.getRecentSessions(limit).then((rows) => {
      if (alive) setSessions(rows);
    });
    return () => {
      alive = false;
    };
  }, [limit, version]);
  return sessions;
}

export function useActiveSession(): {
  snapshot: ActiveSessionSnapshot | null;
  loaded: boolean;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<ActiveSessionSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void progressRepo.loadActiveSession().then((s) => {
      if (alive) {
        setSnapshot(s);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  const reload = () => {
    void progressRepo.loadActiveSession().then((s) => {
      setSnapshot(s);
      setLoaded(true);
    });
  };
  return { snapshot, loaded, reload };
}

export function useLists(): CustomList[] {
  const version = useSyncExternalStore(
    (cb) => listRepo.subscribe(cb),
    () => listRepo.getVersion(),
    () => 0,
  );
  const [lists, setLists] = useState<CustomList[]>([]);
  useEffect(() => {
    let alive = true;
    void listRepo.getAll().then((rows) => {
      if (alive) setLists([...rows]);
    });
    return () => {
      alive = false;
    };
  }, [version]);
  return useMemo(() => lists, [lists]);
}
