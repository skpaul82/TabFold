/**
 * Pure tab-strip logic. An editor group's tabs are described as OrderItems in their current
 * left-to-right order; these helpers decide how to rearrange them so each tab group is contiguous
 * (header first), and how user drags should change group membership.
 */
export interface OrderItem {
  key: string;
  /** Tab-group id the tab belongs to, if any. */
  group?: string;
  isHeader?: boolean;
  pinned?: boolean;
}

/** Each group is gathered at the position of its first tab, header first; other tabs keep their order. */
export function computeTargetOrder(items: readonly OrderItem[]): string[] {
  const out: string[] = [];
  const emitted = new Set<string>();
  for (const it of items) {
    if (it.pinned || !it.group) {
      out.push(it.key);
      continue;
    }
    if (emitted.has(it.group)) continue;
    emitted.add(it.group);
    const members = items.filter((x) => x.group === it.group && !x.pinned);
    out.push(...members.filter((x) => x.isHeader).map((x) => x.key));
    out.push(...members.filter((x) => !x.isHeader).map((x) => x.key));
  }
  return out;
}

export interface Move {
  key: string;
  from: number;
  to: number;
}

/** Minimal-ish sequence of single-tab moves turning `current` into `target` (same keys). */
export function planMoves(current: readonly string[], target: readonly string[]): Move[] {
  const sim = [...current];
  const moves: Move[] = [];
  for (let i = 0; i < target.length; i++) {
    if (sim[i] === target[i]) continue;
    const from = sim.indexOf(target[i]);
    if (from < 0) continue;
    sim.splice(from, 1);
    sim.splice(i, 0, target[i]);
    moves.push({ key: target[i], from, to: i });
  }
  return moves;
}

export interface PositionChanges {
  /** Tabs that were dragged out of their group. */
  leave: string[];
  /** Ungrouped tabs that now sit between two tabs of the same group. */
  join: { key: string; group: string }[];
}

/**
 * Chrome semantics, judged from the tab that just moved (VS Code makes the dragged or newly opened
 * tab active): an ungrouped active tab sitting between two tabs of one group joins it. Otherwise,
 * when a group's tabs are split into several runs, the run holding the header wins, then the
 * largest run, then the run without the active tab; tabs in the other runs leave the group.
 */
export function reconcilePositions(items: readonly OrderItem[], activeKey?: string): PositionChanges {
  const strip = items.filter((x) => !x.pinned).map((x) => ({ ...x }));
  const leave: string[] = [];
  const join: { key: string; group: string }[] = [];

  const ai = strip.findIndex((x) => x.key === activeKey);
  if (ai > 0 && ai < strip.length - 1 && !strip[ai].group) {
    const left = strip[ai - 1];
    const right = strip[ai + 1];
    if (left.group && left.group === right.group && !right.isHeader) {
      join.push({ key: strip[ai].key, group: left.group });
      strip[ai].group = left.group;
    }
  }

  const runs = new Map<string, OrderItem[][]>();
  let prev: OrderItem | undefined;
  for (const it of strip) {
    if (it.group) {
      const list = runs.get(it.group) ?? [];
      if (prev?.group === it.group) list[list.length - 1].push(it);
      else list.push([it]);
      runs.set(it.group, list);
    }
    prev = it;
  }

  for (const groupRuns of runs.values()) {
    if (groupRuns.length < 2) continue;
    const score = (run: OrderItem[]) =>
      (run.some((x) => x.isHeader) ? 1000 : 0) + run.length - (run.some((x) => x.key === activeKey) ? 0.5 : 0);
    const keep = groupRuns.reduce((best, run) => (score(run) > score(best) ? run : best));
    for (const run of groupRuns) {
      if (run === keep) continue;
      leave.push(...run.filter((x) => !x.isHeader).map((x) => x.key));
    }
  }

  return { leave, join };
}
