/**
 * Keeps each group in one editor split. Pure: the controller describes where a group's
 * header and open members are, and gets back where the group should live and which tabs to move.
 */
export interface SplitPlacement {
  /** Column the group lives in (Group.viewColumn). */
  home: number;
  /** Column of the group's header tab, if it has one. */
  headerColumn?: number;
  /** Every member with the columns it's open in (empty when closed). */
  members: { uri: string; columns: number[] }[];
}

/**
 * What to do with members open outside the group's split while others stay home:
 * `leave` = they were dragged out (Chrome), `bring` = they were added by a command, `keep` = do nothing.
 */
export type OutsidePolicy = 'leave' | 'bring' | 'keep';

export interface SplitPlan {
  home: number;
  /** Members to move into `home`. */
  bring: string[];
  /** Members that leave the group. */
  leave: string[];
}

/**
 * The header moved → the group moves with it. All open members moved → the group (and header) follow
 * them to the split holding most of them. Some moved → `outside` decides. A member that is also open in
 * the home split (a Split Editor copy) counts as home.
 */
export function planSplits(p: SplitPlacement, outside: OutsidePolicy): SplitPlan {
  const open = p.members.filter((m) => m.columns.length);
  const notIn = (column: number) => open.filter((m) => !m.columns.includes(column)).map((m) => m.uri);

  if (p.headerColumn !== undefined && p.headerColumn !== p.home) {
    return { home: p.headerColumn, bring: notIn(p.headerColumn), leave: [] };
  }

  const away = notIn(p.home);
  if (!away.length) return { home: p.home, bring: [], leave: [] };

  if (away.length === open.length) {
    const counts = new Map<number, number>();
    for (const m of open) for (const c of m.columns) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best = open[0].columns[0];
    for (const [c, n] of counts) if (n > counts.get(best)!) best = c;
    return { home: best, bring: notIn(best), leave: [] };
  }

  if (outside === 'leave') return { home: p.home, bring: [], leave: away };
  if (outside === 'bring') return { home: p.home, bring: away, leave: [] };
  return { home: p.home, bring: [], leave: [] };
}
