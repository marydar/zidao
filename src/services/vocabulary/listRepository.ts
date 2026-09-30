import type { CustomList, CustomListItem } from '../../types';
import { uid } from '../../lib/date';
import { withDB } from '../storage/db';

/** CRUD for user-authored vocabulary lists (IndexedDB-backed). */
class ListRepository {
  private cache: CustomList[] | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getVersion(): number {
    return this.version;
  }

  private emit() {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  private async ensure(): Promise<CustomList[]> {
    if (this.cache) return this.cache;
    const rows = await withDB(
      async (db) => (await db.getAll('lists')) as CustomList[],
      [] as CustomList[],
    );
    rows.sort((a, b) => a.createdAt - b.createdAt);
    this.cache = rows;
    return rows;
  }

  async getAll(): Promise<CustomList[]> {
    return this.ensure();
  }

  async get(id: string): Promise<CustomList | null> {
    const rows = await this.ensure();
    return rows.find((l) => l.id === id) ?? null;
  }

  async create(name: string, items: CustomListItem[] = []): Promise<CustomList> {
    const rows = await this.ensure();
    const now = Date.now();
    const list: CustomList = { id: uid('list-'), name: name.trim() || 'Untitled list', items, createdAt: now, updatedAt: now };
    rows.push(list);
    await withDB(async (db) => db.put('lists', list), undefined);
    this.emit();
    return list;
  }

  async update(list: CustomList): Promise<void> {
    const rows = await this.ensure();
    const idx = rows.findIndex((l) => l.id === list.id);
    const next = { ...list, updatedAt: Date.now() };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    await withDB(async (db) => db.put('lists', next), undefined);
    this.emit();
  }

  async remove(id: string): Promise<void> {
    const rows = await this.ensure();
    const idx = rows.findIndex((l) => l.id === id);
    if (idx >= 0) rows.splice(idx, 1);
    await withDB(async (db) => db.delete('lists', id), undefined);
    this.emit();
  }
}

export const listRepo = new ListRepository();
