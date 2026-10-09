import * as vscode from 'vscode';

export interface Config {
  side: boolean;
  /** Reorder tabs so groups stay contiguous. */
  reorder: boolean;
  headerTabs: boolean;
  colorTabs: boolean;
  badgeStyle: 'letter' | 'dot' | 'none';
  joinByPosition: boolean;
}

export function config(): Config {
  const c = vscode.workspace.getConfiguration('tabGroups');
  const placement = c.get<string>('placement', 'top+side');
  const top = placement !== 'side';
  return {
    side: placement !== 'top',
    reorder: top,
    headerTabs: top && c.get<boolean>('headerTabs', true),
    colorTabs: top && c.get<boolean>('colorTabs', true),
    badgeStyle: top ? c.get<Config['badgeStyle']>('badgeStyle', 'letter') : 'none',
    joinByPosition: top && c.get<boolean>('joinByPosition', true),
  };
}
