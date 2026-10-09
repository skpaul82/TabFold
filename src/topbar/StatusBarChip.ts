import * as vscode from 'vscode';
import type { GroupStore } from '../model/GroupStore.ts';
import { displayName, type Group } from '../model/types.ts';

/** Shows the active tab's group in the status bar; click to switch groups. */
export class StatusBarChip implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('tabGroups.current', vscode.StatusBarAlignment.Left, 100);
  private readonly store: GroupStore;
  private readonly activeGroup: () => Group | undefined;

  constructor(store: GroupStore, activeGroup: () => Group | undefined) {
    this.store = store;
    this.activeGroup = activeGroup;
    this.item.name = 'Tab Groups';
    this.item.command = 'tabGroups.switchGroup';
    this.update();
    this.item.show();
  }

  update(): void {
    const g = this.activeGroup();
    if (g) {
      this.item.text = `$(circle-large-filled) ${displayName(g)}${g.collapsed ? ' (collapsed)' : ''}`;
      this.item.color = new vscode.ThemeColor(`tabGroups.${g.color}`);
      this.item.tooltip = `Tab group "${displayName(g)}" · ${g.members.length} tabs\nClick to switch groups`;
    } else {
      const n = this.store.all().length;
      this.item.text = n ? `$(layers) ${n}` : '$(layers)';
      this.item.color = undefined;
      this.item.tooltip = n ? `${n} tab group${n === 1 ? '' : 's'} · click to switch` : 'Tab Groups · click to group the current tab';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
