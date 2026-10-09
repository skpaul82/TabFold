import { GROUP_COLORS, type Group, type GroupColor, type SavedGroup } from './types.ts';

/** Subset of vscode.Memento, so the store can be unit-tested without VS Code. */
export interface StateStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** A group as it was, plus its sidebar position, so it can be put back (undo). */
export interface GroupSnapshot {
  group: Group;
  index: number;
}

const GROUPS_KEY = 'tabGroups.groups.v1';
const SAVED_KEY = 'tabGroups.saved.v1';

export class GroupStore {
  private groups: Group[] = [];
  private saved: SavedGroup[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly workspace: StateStorage;
  private readonly global: StateStorage;

  constructor(workspace: StateStorage, global: StateStorage) {
    this.workspace = workspace;
    this.global = global;
    this.groups = structuredClone(workspace.get<Group[]>(GROUPS_KEY) ?? []);
    this.saved = structuredClone(global.get<SavedGroup[]>(SAVED_KEY) ?? []);
  }

  onChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  all(): readonly Group[] {
    return this.groups;
  }

  get(id: string): Group | undefined {
    return this.groups.find((g) => g.id === id);
  }

  groupOf(uri: string): Group | undefined {
    return this.groups.find((g) => g.members.includes(uri));
  }

  nextColor(): GroupColor {
    const used = new Set(this.groups.map((g) => g.color));
    return GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[this.groups.length % GROUP_COLORS.length];
  }

  create(init: { name: string; color: GroupColor; uris: string[]; viewColumn: number; id?: string }): Group {
    this.detach(init.uris);
    const group: Group = {
      id: init.id && !this.get(init.id) ? init.id : newId(),
      name: init.name,
      color: init.color,
      collapsed: false,
      members: dedupe(init.uris),
      viewColumn: init.viewColumn,
    };
    this.groups.push(group);
    this.commit();
    return group;
  }

  update(id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'collapsed' | 'viewColumn'>>): void {
    const g = this.get(id);
    if (!g) return;
    Object.assign(g, patch);
    this.commit();
  }

  /** Adds URIs to a group, at `index` if given, taking them out of any other group. */
  addMembers(id: string, uris: string[], index?: number): void {
    const g = this.get(id);
    if (!g) return;
    this.detach(uris, id);
    const incoming = dedupe(uris);
    const rest = g.members.filter((m) => !incoming.includes(m));
    const at = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
    g.members = [...rest.slice(0, at), ...incoming, ...rest.slice(at)];
    this.commit();
  }

  /** Removes URIs from whatever group holds them. Groups left empty are deleted. */
  removeMembers(uris: string[]): void {
    this.detach(uris);
    this.commit();
  }

  replaceUri(oldUri: string, newUri: string): void {
    let changed = false;
    for (const g of this.groups) {
      const i = g.members.indexOf(oldUri);
      if (i >= 0) {
        g.members[i] = newUri;
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  remove(id: string): void {
    this.groups = this.groups.filter((g) => g.id !== id);
    this.commit();
  }

  removeAll(): void {
    this.groups = [];
    this.commit();
  }

  /** Copies of the given groups with their sidebar positions, for undo. */
  snapshot(ids: string[]): GroupSnapshot[] {
    return ids.flatMap((id) => {
      const index = this.groups.findIndex((g) => g.id === id);
      return index < 0 ? [] : [{ group: structuredClone(this.groups[index]), index }];
    });
  }

  /**
   * Puts snapshotted groups back at their old sidebar positions (undo). Their URIs leave any group
   * that took them since. Snapshots whose id is in use again, or that have no members, are skipped.
   */
  restore(snapshots: GroupSnapshot[]): Group[] {
    const restored: Group[] = [];
    for (const { group, index } of [...snapshots].sort((a, b) => a.index - b.index)) {
      if (this.get(group.id) || !group.members.length) continue;
      const g = structuredClone(group);
      g.members = dedupe(g.members);
      this.detach(g.members);
      this.groups.splice(Math.min(index, this.groups.length), 0, g);
      restored.push(g);
    }
    if (restored.length) this.commit();
    return restored;
  }

  /** Moves group `id` to sit before `beforeId` (or to the end). Only affects sidebar order. */
  move(id: string, beforeId?: string): void {
    const g = this.get(id);
    if (!g || id === beforeId) return;
    const rest = this.groups.filter((x) => x.id !== id);
    const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, g);
    this.groups = rest;
    this.commit();
  }

  // ---- saved snapshots (global, so they work across workspaces) ----

  savedGroups(): readonly SavedGroup[] {
    return this.saved;
  }

  saveSnapshot(id: string): SavedGroup | undefined {
    const g = this.get(id);
    if (!g) return undefined;
    const snap: SavedGroup = { id: g.id, name: g.name, color: g.color, uris: [...g.members], savedAt: Date.now() };
    const i = this.saved.findIndex((s) => s.id === g.id);
    if (i >= 0) this.saved[i] = snap;
    else this.saved.push(snap);
    this.commit();
    return snap;
  }

  deleteSaved(id: string): void {
    this.saved = this.saved.filter((s) => s.id !== id);
    this.commit();
  }

  private detach(uris: string[], exceptId?: string): void {
    const set = new Set(uris);
    for (const g of this.groups) {
      if (g.id === exceptId) continue;
      g.members = g.members.filter((m) => !set.has(m));
    }
    this.groups = this.groups.filter((g) => g.members.length > 0 || g.id === exceptId);
  }

  private commit(): void {
    void this.workspace.update(GROUPS_KEY, this.groups);
    void this.global.update(SAVED_KEY, this.saved);
    for (const l of this.listeners) l();
  }
}

function newId(): string {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
