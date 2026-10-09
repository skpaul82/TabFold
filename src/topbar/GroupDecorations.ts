import * as vscode from 'vscode';
import type { GroupStore } from '../model/GroupStore.ts';
import { displayName } from '../model/types.ts';
import { config } from '../config.ts';

/** Colors grouped tab titles (and their sidebar/explorer entries) and adds a small badge. */
export class GroupDecorations implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly store: GroupStore;

  constructor(store: GroupStore) {
    this.store = store;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const g = this.store.groupOf(uri.toString());
    if (!g) return undefined;
    const c = config();
    const badge = c.badgeStyle === 'letter' ? badgeLetter(g.name) : c.badgeStyle === 'dot' ? '●' : undefined;
    const color = c.colorTabs ? new vscode.ThemeColor(`tabGroups.${g.color}`) : undefined;
    if (!badge && !color) return undefined;
    return { badge, color, tooltip: `Tab group: ${displayName(g)}` };
  }
}

function badgeLetter(name: string): string {
  const ch = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c));
  return ch ? ch.toUpperCase() : '●';
}
