export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const COLOR_EMOJI: Record<GroupColor, string> = {
  grey: '⚫',
  blue: '🔵',
  red: '🔴',
  yellow: '🟡',
  green: '🟢',
  pink: '🩷',
  purple: '🟣',
  cyan: '🩵',
  orange: '🟠',
};

/** A named, colored set of editor tabs. Members are URI strings; a URI belongs to at most one group. */
export interface Group {
  id: string;
  name: string;
  color: GroupColor;
  collapsed: boolean;
  members: string[];
  /** VS Code editor group (split) column the group lives in. */
  viewColumn: number;
}

export interface SavedGroup {
  id: string;
  name: string;
  color: GroupColor;
  uris: string[];
  savedAt: number;
}

export function displayName(g: { name: string }): string {
  return g.name.trim() || 'Untitled group';
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
